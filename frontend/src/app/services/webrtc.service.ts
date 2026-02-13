import { Injectable } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { WebSocketService } from './websocket.service';
import { AuthService } from '@core/services/auth.service';

export interface Participant {
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class WebRTCService {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private channelId: string | null = null;

  private participantsSubject = new BehaviorSubject<Map<string, Participant>>(new Map());
  participants$ = this.participantsSubject.asObservable();

  private localStreamSubject = new BehaviorSubject<MediaStream | null>(null);
  localStream$ = this.localStreamSubject.asObservable();

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  constructor(
    private wsService: WebSocketService,
    private authService: AuthService
  ) {}

  async startCall(channelId: string): Promise<void> {
    this.channelId = channelId;

    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    this.localStreamSubject.next(this.localStream);

    // Listen for WebRTC signaling via WebSocket
    this.wsService.connect(channelId).subscribe((msg) => {
      this.handleSignaling(msg);
    });

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
        await this.handleOffer(msg);
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

  private async handleOffer(msg: any): Promise<void> {
    const pc = this.createPeerConnection(msg.from_user_id, msg.display_name);

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

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.wsService.send(this.channelId!, {
          type: 'ice-candidate',
          target_user_id: userId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
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

  endCall(): void {
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
