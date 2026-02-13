import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { WebRTCService, Participant } from '@services/webrtc.service';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="video-room">
      <!-- Video Grid -->
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
            <mat-icon *ngIf="!audioEnabled" class="status-icon">mic_off</mat-icon>
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
            <mat-icon *ngIf="!p.audioEnabled" class="status-icon">mic_off</mat-icon>
          </div>
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
    .status-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #ff5252;
    }
    .video-controls {
      display: flex;
      justify-content: center;
      gap: 16px;
      padding: 20px;
      background: #292929;
    }
  `],
})
export class VideoRoomComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;

  channelId = '';
  audioOnly = false;
  participants = new Map<string, Participant>();
  participantList: Participant[] = [];
  audioEnabled = true;
  videoEnabled = true;
  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private webrtcService: WebRTCService,
    private apiService: ApiService,
  ) {}

  ngOnInit(): void {
    this.channelId = this.route.snapshot.paramMap.get('channelId') || '';
    this.audioOnly = this.route.snapshot.queryParamMap.get('audio') === 'true';

    if (this.audioOnly) {
      this.videoEnabled = false;
    }

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

        setTimeout(() => {
          this.participantList.forEach((p) => {
            const el = document.getElementById('video-' + p.userId) as HTMLVideoElement;
            if (el && p.stream) {
              el.srcObject = p.stream;
            }
          });
        }, 100);
      })
    );
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

  endCall(): void {
    this.webrtcService.endCall();
    this.apiService.leaveVideoRoom(this.channelId).subscribe();
    this.router.navigate(['/chat', this.channelId]);
  }
}
