import { Component, OnInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { WebRTCService, Participant } from '@services/webrtc.service';
import { WebSocketService } from '@services/websocket.service';
import { ApiService } from '@services/api.service';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, MatSnackBarModule],
  template: `
    <div class="video-room">
      <!-- Error banner -->
      <div class="error-banner" *ngIf="mediaError">
        <mat-icon>warning</mat-icon>
        <span>{{ mediaError }}</span>
        <button mat-icon-button (click)="endCall()">
          <mat-icon>arrow_back</mat-icon>
        </button>
      </div>

      <!-- Presenter banner -->
      <div class="presenter-banner" *ngIf="presenter || isScreenSharing">
        <mat-icon>present_to_all</mat-icon>
        <span *ngIf="isScreenSharing">Du praesentierst deinen Bildschirm</span>
        <span *ngIf="!isScreenSharing && presenter">{{ presenter.displayName }} praesentiert</span>
      </div>

      <!-- Presentation Layout (when someone is sharing screen) -->
      <div class="presentation-layout" *ngIf="presenter || isScreenSharing; else normalGrid">
        <!-- Main presentation area -->
        <div class="presentation-main">
          <!-- Screen share preview (local) -->
          <div class="presentation-video" *ngIf="isScreenSharing">
            <video #screenVideo autoplay playsinline></video>
            <div class="video-label">
              <mat-icon>screen_share</mat-icon>
              Dein Bildschirm
            </div>
          </div>
          <!-- Remote presenter's stream -->
          <div class="presentation-video" *ngIf="!isScreenSharing && presenter">
            <video [id]="'presenter-video-' + presenter.userId" autoplay playsinline></video>
            <div class="video-label">
              <mat-icon>screen_share</mat-icon>
              {{ presenter.displayName }}
            </div>
          </div>
        </div>

        <!-- Side strip with participants -->
        <div class="presentation-sidebar">
          <!-- Local video (small) -->
          <div class="video-tile small" [class.audio-tile]="audioOnly || !videoEnabled">
            <video *ngIf="!audioOnly && videoEnabled" #localVideo autoplay muted playsinline></video>
            <div *ngIf="audioOnly || !videoEnabled" class="audio-avatar small">
              <mat-icon>{{ audioEnabled ? 'mic' : 'mic_off' }}</mat-icon>
            </div>
            <div class="video-label">Du</div>
          </div>
          <!-- Remote videos (small) -->
          <div *ngFor="let p of participantList" class="video-tile small"
               [class.audio-tile]="!p.videoEnabled">
            <video [id]="'video-' + p.userId" autoplay playsinline></video>
            <div *ngIf="!p.videoEnabled" class="audio-avatar small">
              <mat-icon>person</mat-icon>
            </div>
            <div class="video-label">{{ p.displayName }}</div>
          </div>
        </div>
      </div>

      <!-- Normal Video Grid (no presentation) -->
      <ng-template #normalGrid>
        <div class="video-grid" [class.single]="participants.size === 0"
             [class.audio-only]="audioOnly">
          <!-- Local Video -->
          <div class="video-tile local" [class.audio-tile]="audioOnly || !videoEnabled">
            <video *ngIf="!audioOnly" #localVideo autoplay muted playsinline></video>
            <div *ngIf="audioOnly || !videoEnabled" class="audio-avatar">
              <mat-icon>{{ audioEnabled ? 'mic' : 'mic_off' }}</mat-icon>
              <span>Du</span>
            </div>
            <div class="video-label">Du
              <mat-icon *ngIf="!audioEnabled" class="mute-icon">mic_off</mat-icon>
            </div>
          </div>

          <!-- Remote Videos -->
          <div *ngFor="let p of participantList" class="video-tile"
               [class.audio-tile]="!p.videoEnabled">
            <video [id]="'video-' + p.userId" autoplay playsinline></video>
            <div *ngIf="!p.videoEnabled" class="audio-avatar">
              <mat-icon>{{ p.audioEnabled ? 'person' : 'mic_off' }}</mat-icon>
              <span>{{ p.displayName }}</span>
            </div>
            <div class="video-label">{{ p.displayName }}
              <mat-icon *ngIf="!p.audioEnabled" class="mute-icon">mic_off</mat-icon>
            </div>
          </div>
        </div>
      </ng-template>

      <!-- Invite Panel -->
      <div class="invite-panel" *ngIf="showInvitePanel">
        <div class="invite-panel-header">
          <span>Benutzer anrufen</span>
          <button mat-icon-button (click)="showInvitePanel = false">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        <div class="invite-panel-list">
          <div *ngFor="let m of callableMembers" class="invite-member-item">
            <div class="invite-member-avatar">{{ m.display_name?.charAt(0)?.toUpperCase() }}</div>
            <div class="invite-member-info">
              <span class="invite-member-name">{{ m.display_name }}</span>
              <span class="invite-member-username">{{'@' + m.username}}</span>
            </div>
            <button mat-icon-button
                    [matTooltip]="invitedUserIds.has(m.id) ? 'Eingeladen' : 'Anrufen'"
                    (click)="inviteToCall(m)"
                    [disabled]="invitedUserIds.has(m.id)">
              <mat-icon>{{ invitedUserIds.has(m.id) ? 'check_circle' : 'call' }}</mat-icon>
            </button>
          </div>
          <p *ngIf="callableMembers.length === 0" class="no-members">Keine weiteren Mitglieder</p>
        </div>
      </div>

      <!-- Controls -->
      <div class="video-controls">
        <button mat-fab [color]="audioEnabled ? 'primary' : 'warn'"
                (click)="toggleAudio()" matTooltip="Mikrofon">
          <mat-icon>{{ audioEnabled ? 'mic' : 'mic_off' }}</mat-icon>
        </button>
        <button mat-fab [color]="videoEnabled ? 'primary' : 'warn'"
                (click)="toggleVideo()" matTooltip="Kamera"
                *ngIf="!audioOnly">
          <mat-icon>{{ videoEnabled ? 'videocam' : 'videocam_off' }}</mat-icon>
        </button>
        <button mat-fab
                [color]="isScreenSharing ? 'accent' : undefined"
                (click)="toggleScreenShare()"
                [matTooltip]="isScreenSharing ? 'Freigabe beenden' : 'Bildschirm freigeben'">
          <mat-icon>{{ isScreenSharing ? 'stop_screen_share' : 'screen_share' }}</mat-icon>
        </button>
        <button mat-fab (click)="toggleInvitePanel()" matTooltip="Benutzer anrufen"
                [color]="showInvitePanel ? 'accent' : undefined">
          <mat-icon>person_add</mat-icon>
        </button>
        <button mat-fab color="warn" (click)="endCall()" matTooltip="Auflegen">
          <mat-icon>call_end</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .video-room {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #1a1a1a;
    }
    /* Error banner */
    .error-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: #c4314b;
      color: white;
      font-size: 14px;
    }
    .error-banner mat-icon:first-child {
      font-size: 24px;
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }
    .error-banner span { flex: 1; }
    .error-banner button { color: white; }
    /* Presenter banner */
    .presenter-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #6264a7;
      color: white;
      font-size: 13px;
      font-weight: 500;
    }
    .presenter-banner mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    /* Presentation layout */
    .presentation-layout {
      flex: 1;
      display: flex;
      gap: 8px;
      padding: 8px;
      overflow: hidden;
    }
    .presentation-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .presentation-video {
      width: 100%;
      height: 100%;
      position: relative;
      background: #2d2d2d;
      border-radius: 8px;
      overflow: hidden;
    }
    .presentation-video video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    }
    .presentation-sidebar {
      width: 200px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      flex-shrink: 0;
    }
    .video-tile.small {
      aspect-ratio: 16/9;
      max-width: 200px;
    }
    .video-tile.small .audio-avatar {
      gap: 4px;
    }
    .video-tile.small .audio-avatar mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      padding: 8px;
    }
    /* Normal grid */
    .video-grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 8px;
      padding: 16px;
      align-content: center;
    }
    .video-grid.single {
      grid-template-columns: 1fr;
    }
    .video-grid.audio-only {
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    }
    .video-tile {
      position: relative;
      background: #2d2d2d;
      border-radius: 8px;
      overflow: hidden;
      aspect-ratio: 16/9;
    }
    .video-tile.audio-tile {
      aspect-ratio: 1;
      max-width: 200px;
      justify-self: center;
    }
    .video-tile video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .video-tile.local video {
      transform: scaleX(-1);
    }
    .audio-avatar {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: white;
      gap: 8px;
    }
    .audio-avatar mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      background: rgba(255,255,255,0.1);
      border-radius: 50%;
      padding: 16px;
      box-sizing: content-box;
    }
    .audio-avatar span {
      font-size: 14px;
    }
    .video-label {
      position: absolute;
      bottom: 8px;
      left: 8px;
      background: rgba(0,0,0,0.6);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .mute-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #ff5252;
    }
    .invite-panel {
      position: absolute;
      right: 16px;
      bottom: 100px;
      width: 280px;
      background: #333;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      z-index: 10;
      overflow: hidden;
    }
    .invite-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #3a3a3a;
      color: white;
      font-weight: 500;
      font-size: 14px;
    }
    .invite-panel-header button { color: #aaa; }
    .invite-panel-list {
      max-height: 250px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .invite-member-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
    }
    .invite-member-item:hover {
      background: #3d3d3d;
    }
    .invite-member-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #6200ee;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .invite-member-info { flex: 1; }
    .invite-member-name { color: white; font-size: 13px; font-weight: 500; display: block; }
    .invite-member-username { color: #aaa; font-size: 11px; }
    .invite-member-item button { color: #76ff03; }
    .invite-member-item button[disabled] { color: #666; }
    .no-members { color: #888; text-align: center; padding: 16px; font-size: 13px; }
    .video-controls {
      display: flex;
      justify-content: center;
      gap: 16px;
      padding: 20px;
      background: #292929;
    }
  `],
})
export class VideoRoomComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('screenVideo') screenVideo!: ElementRef<HTMLVideoElement>;

  channelId = '';
  audioOnly = false;
  participants = new Map<string, Participant>();
  participantList: Participant[] = [];
  audioEnabled = true;
  videoEnabled = true;
  isScreenSharing = false;
  presenter: { userId: string; displayName: string } | null = null;
  mediaError: string | null = null;
  showInvitePanel = false;
  channelMembers: any[] = [];
  callableMembers: any[] = [];
  invitedUserIds = new Set<string>();
  private currentUserId = '';
  private subscriptions: Subscription[] = [];
  private pendingStreamAttach = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private webrtcService: WebRTCService,
    private wsService: WebSocketService,
    private apiService: ApiService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.channelId = this.route.snapshot.paramMap.get('channelId') || '';
    this.audioOnly = this.route.snapshot.queryParamMap.get('audio') === 'true';
    this.currentUserId = this.authService.getCurrentUser()?.id || '';

    if (this.audioOnly) {
      this.videoEnabled = false;
    }

    this.loadChannelMembers();

    // Create or get existing room, then join
    this.apiService.createVideoRoom(this.channelId).subscribe({
      next: () => {
        this.apiService.joinVideoRoom(this.channelId).subscribe();
      },
      error: () => {
        // Room may already exist, try joining directly
        this.apiService.joinVideoRoom(this.channelId).subscribe();
      },
    });

    this.webrtcService.startCall(this.channelId, this.audioOnly);

    // Subscribe to local stream
    this.subscriptions.push(
      this.webrtcService.localStream$.subscribe((stream) => {
        if (stream && this.localVideo?.nativeElement) {
          this.localVideo.nativeElement.srcObject = stream;
        }
      })
    );

    // Subscribe to participants
    this.subscriptions.push(
      this.webrtcService.participants$.subscribe((participants) => {
        this.participants = participants;
        this.participantList = Array.from(participants.values());
        this.updateCallableMembers();
        this.pendingStreamAttach = true;
        this.cdr.detectChanges();
      })
    );

    // Subscribe to screen sharing state – layout switches from normalGrid
    // to presentation-layout, destroying/recreating video DOM elements.
    this.subscriptions.push(
      this.webrtcService.isScreenSharing$.subscribe((sharing) => {
        this.isScreenSharing = sharing;
        this.pendingStreamAttach = true;
        this.cdr.detectChanges();
      })
    );

    // Subscribe to screen share stream (for local preview)
    this.subscriptions.push(
      this.webrtcService.screenShare$.subscribe((stream) => {
        setTimeout(() => {
          if (stream && this.screenVideo?.nativeElement) {
            this.screenVideo.nativeElement.srcObject = stream;
          }
        }, 100);
      })
    );

    // Subscribe to remote presenter – also triggers layout switch
    this.subscriptions.push(
      this.webrtcService.presenter$.subscribe((presenter) => {
        this.presenter = presenter;
        this.pendingStreamAttach = true;
        this.cdr.detectChanges();
        if (presenter) {
          this.snackBar.open(`${presenter.displayName} praesentiert den Bildschirm`, 'OK', { duration: 3000 });
        }
      })
    );

    // Subscribe to errors (e.g. insecure context)
    this.subscriptions.push(
      this.webrtcService.error$.subscribe((error) => {
        this.mediaError = error;
      })
    );
  }

  ngAfterViewChecked(): void {
    if (this.pendingStreamAttach) {
      this.pendingStreamAttach = false;
      this.attachRemoteStreams();
    }
  }

  private attachRemoteStreams(): void {
    this.participantList.forEach((p) => {
      // Sidebar / normal-grid video element
      const el = document.getElementById('video-' + p.userId) as HTMLVideoElement;
      if (el && p.stream && el.srcObject !== p.stream) {
        el.srcObject = p.stream;
      }
      // Presentation main area (uses a separate ID to avoid duplicate IDs)
      const presEl = document.getElementById('presenter-video-' + p.userId) as HTMLVideoElement;
      if (presEl && p.stream && presEl.srcObject !== p.stream) {
        presEl.srcObject = p.stream;
      }
    });

    // Also re-attach localVideo after layout switches (the #localVideo
    // ViewChild may point to a destroyed element after *ngIf toggles).
    // Using take(1) instead of manual unsubscribe to avoid a TDZ error:
    // BehaviorSubject fires synchronously, so the callback would run
    // before the subscription variable is assigned.
    if (this.localVideo?.nativeElement) {
      this.webrtcService.localStream$.pipe(take(1)).subscribe((stream) => {
        if (stream && this.localVideo?.nativeElement && this.localVideo.nativeElement.srcObject !== stream) {
          this.localVideo.nativeElement.srcObject = stream;
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.webrtcService.endCall();
    this.apiService.leaveVideoRoom(this.channelId).subscribe();
  }

  toggleAudio(): void {
    this.audioEnabled = this.webrtcService.toggleAudio();
  }

  toggleVideo(): void {
    this.videoEnabled = this.webrtcService.toggleVideo();
  }

  async toggleScreenShare(): Promise<void> {
    if (this.isScreenSharing) {
      this.webrtcService.stopScreenShare();
    } else {
      const stream = await this.webrtcService.startScreenShare();
      if (!stream) {
        this.snackBar.open('Bildschirmfreigabe wurde abgebrochen', 'OK', { duration: 2000 });
      }
    }
  }

  loadChannelMembers(): void {
    this.apiService.getChannelMembers(this.channelId).subscribe((members) => {
      this.channelMembers = members;
      this.updateCallableMembers();
    });
  }

  private updateCallableMembers(): void {
    const inCallIds = new Set(this.participantList.map((p) => p.userId));
    inCallIds.add(this.currentUserId);
    this.callableMembers = this.channelMembers
      .map((m: any) => m.user || m)
      .filter((u: any) => !inCallIds.has(u.id));
  }

  toggleInvitePanel(): void {
    this.showInvitePanel = !this.showInvitePanel;
    if (this.showInvitePanel) {
      this.updateCallableMembers();
    }
  }

  inviteToCall(user: any): void {
    this.wsService.send(this.channelId, {
      type: 'video_call_invite',
      target_user_id: user.id,
      audio_only: this.audioOnly,
    });
    this.invitedUserIds.add(user.id);
    this.snackBar.open(`${user.display_name} wurde angerufen`, 'OK', { duration: 3000 });
  }

  endCall(): void {
    this.webrtcService.endCall();
    this.apiService.leaveVideoRoom(this.channelId).subscribe();
    this.router.navigate(['/chat', this.channelId]);
  }
}
