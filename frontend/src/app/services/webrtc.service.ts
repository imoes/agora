import { Injectable, NgZone } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { WebSocketService } from './websocket.service';
import { AuthService } from '@core/services/auth.service';

export interface Participant {
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenShare?: boolean;
}

@Injectable({ providedIn: 'root' })
export class WebRTCService {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private channelId: string | null = null;
  private originalVideoTrack: MediaStreamTrack | null = null;

  private participantsSubject = new BehaviorSubject<Map<string, Participant>>(new Map());
  participants$ = this.participantsSubject.asObservable();

  private localStreamSubject = new BehaviorSubject<MediaStream | null>(null);
  localStream$ = this.localStreamSubject.asObservable();

  private screenShareSubject = new BehaviorSubject<MediaStream | null>(null);
  screenShare$ = this.screenShareSubject.asObservable();

  private screenSharingSubject = new BehaviorSubject<boolean>(false);
  isScreenSharing$ = this.screenSharingSubject.asObservable();

  private presenterSubject = new BehaviorSubject<{ userId: string; displayName: string } | null>(null);
  presenter$ = this.presenterSubject.asObservable();

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  constructor(
    private wsService: WebSocketService,
    private authService: AuthService,
    private ngZone: NgZone
  ) {}

  private errorSubject = new Subject<string>();
  error$ = this.errorSubject.asObservable();

  async startCall(channelId: string, audioOnly: boolean = false): Promise<void> {
    this.channelId = channelId;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.errorSubject.next(
        'Kamera/Mikrofon nicht verfuegbar. Videoanrufe erfordern HTTPS. ' +
        'Bitte greife ueber https:// oder localhost auf die App zu.'
      );
      return;
    }

    try {
      const constraints: MediaStreamConstraints = audioOnly
        ? { audio: true, video: false }
        : { video: true, audio: true };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStreamSubject.next(this.localStream);
    } catch (err: any) {
      this.errorSubject.next(
        'Zugriff auf Kamera/Mikrofon verweigert: ' + (err?.message || 'Unbekannter Fehler')
      );
      return;
    }

    // Listen for WebRTC signaling via WebSocket
    this.wsService.connect(channelId).subscribe((msg) => {
      this.handleSignaling(msg);
    });

    // Wait for WebSocket to be open before announcing – the chat page
    // closes its WebSocket on navigation, so a fresh connection is created
    // which may still be CONNECTING at this point.
    await this.wsService.waitForOpen(channelId);

    // Announce call start
    this.wsService.send(channelId, { type: 'video_call_start' });
  }

  async handleSignaling(msg: any): Promise<void> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    switch (msg.type) {
      case 'video_call_start':
        if (msg.user_id !== currentUser.id) {
          await this.createOffer(msg.user_id, msg.display_name);
        }
        break;

      case 'offer':
        await this.handleOffer(msg, currentUser.id);
        break;

      case 'answer':
        await this.handleAnswer(msg);
        break;

      case 'ice-candidate':
        await this.handleIceCandidate(msg);
        break;

      case 'video_call_end':
        this.removePeer(msg.user_id);
        break;

      case 'screen_share_start':
        if (msg.user_id !== currentUser.id) {
          this.presenterSubject.next({
            userId: msg.user_id,
            displayName: msg.display_name,
          });
        }
        break;

      case 'screen_share_stop':
        if (this.presenterSubject.value?.userId === msg.user_id) {
          this.presenterSubject.next(null);
        }
        break;
    }
  }

  private async createOffer(targetUserId: string, displayName: string): Promise<void> {
    const pc = this.createPeerConnection(targetUserId, displayName);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.wsService.send(this.channelId!, {
      type: 'offer',
      target_user_id: targetUserId,
      sdp: offer.sdp,
    });
  }

  private async handleOffer(msg: any, localUserId: string): Promise<void> {
    const pc = this.createPeerConnection(msg.from_user_id, msg.display_name);

    // Polite-peer glare resolution: when both sides sent offers
    // simultaneously, the peer connection is in "have-local-offer".
    // The "polite" peer (lower ID) rolls back its own offer and accepts
    // the incoming one. The "impolite" peer (higher ID) ignores it —
    // the polite peer's answer to *its* offer will arrive shortly.
    if (pc.signalingState === 'have-local-offer') {
      const isPolite = localUserId < msg.from_user_id;
      if (!isPolite) {
        return; // impolite peer: ignore the colliding offer
      }
      // polite peer: rollback own offer, accept the remote one
      await pc.setLocalDescription({ type: 'rollback' });
    }

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.wsService.send(this.channelId!, {
      type: 'answer',
      target_user_id: msg.from_user_id,
      sdp: answer.sdp,
    });
  }

  private async handleAnswer(msg: any): Promise<void> {
    const pc = this.peerConnections.get(msg.from_user_id);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
    }
  }

  private async handleIceCandidate(msg: any): Promise<void> {
    const pc = this.peerConnections.get(msg.from_user_id);
    if (pc && msg.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
  }

  private createPeerConnection(userId: string, displayName: string): RTCPeerConnection {
    if (this.peerConnections.has(userId)) {
      return this.peerConnections.get(userId)!;
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(userId, pc);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle ICE candidates – also runs outside Angular zone
    pc.onicecandidate = (event) => {
      this.ngZone.run(() => {
        if (event.candidate) {
          this.wsService.send(this.channelId!, {
            type: 'ice-candidate',
            target_user_id: userId,
            candidate: event.candidate.toJSON(),
          });
        }
      });
    };

    // Handle remote stream – ontrack fires outside Angular's zone
    // (Zone.js does not patch RTCPeerConnection callbacks), so we
    // must re-enter the zone to trigger change detection.
    pc.ontrack = (event) => {
      this.ngZone.run(() => {
        const participants = this.participantsSubject.value;
        const existing = participants.get(userId);
        participants.set(userId, {
          userId,
          displayName,
          stream: event.streams[0] || null,
          audioEnabled: existing?.audioEnabled ?? true,
          videoEnabled: existing?.videoEnabled ?? true,
        });
        this.participantsSubject.next(new Map(participants));
      });
    };

    return pc;
  }

  private removePeer(userId: string): void {
    const pc = this.peerConnections.get(userId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(userId);
    }
    const participants = this.participantsSubject.value;
    participants.delete(userId);
    this.participantsSubject.next(new Map(participants));
    // Clear presenter if the presenter left
    if (this.presenterSubject.value?.userId === userId) {
      this.presenterSubject.next(null);
    }
  }

  toggleAudio(): boolean {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  toggleVideo(): boolean {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
    }
    return false;
  }

  async startScreenShare(): Promise<MediaStream | null> {
    if (!this.channelId) return null;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.errorSubject.next('Bildschirmfreigabe erfordert HTTPS.');
      return null;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];

      // Save original video track
      if (this.localStream) {
        this.originalVideoTrack = this.localStream.getVideoTracks()[0] || null;
      }

      // Replace the video track in all peer connections with screen track
      this.peerConnections.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          // No video sender exists (audio-only call) — add screen track
          pc.addTrack(screenTrack, this.screenStream!);
        }
      });

      this.screenSharingSubject.next(true);
      this.screenShareSubject.next(this.screenStream);

      // Notify others
      this.wsService.send(this.channelId, { type: 'screen_share_start' });

      // Handle user stopping screen share via browser UI
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      return this.screenStream;
    } catch {
      return null;
    }
  }

  stopScreenShare(): void {
    if (!this.channelId || !this.screenStream) return;

    // Restore original video track BEFORE stopping screen tracks,
    // so the sender still holds a reference to the screen track
    // and can be found via sender.track?.kind === 'video'.
    if (this.originalVideoTrack) {
      this.peerConnections.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(this.originalVideoTrack);
        }
      });
    }

    // Now stop screen tracks
    this.screenStream.getTracks().forEach((t) => t.stop());

    this.screenStream = null;
    this.screenSharingSubject.next(false);
    this.screenShareSubject.next(null);

    // Notify others
    this.wsService.send(this.channelId, { type: 'screen_share_stop' });
  }

  endCall(): void {
    // Stop screen share if active
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.screenSharingSubject.next(false);
      this.screenShareSubject.next(null);
    }
    this.presenterSubject.next(null);
    this.originalVideoTrack = null;

    if (this.channelId) {
      this.wsService.send(this.channelId, { type: 'video_call_end' });
    }

    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.localStreamSubject.next(null);
    this.participantsSubject.next(new Map());
    this.channelId = null;
  }
}
