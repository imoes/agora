import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService, User, UserStatus, STATUS_LABELS, STATUS_ICONS } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatBadgeModule, MatButtonModule, MatMenuModule, MatDividerModule,
  ],
  template: `
    <div class="layout">
      <!-- Sidebar -->
      <nav class="sidebar">
        <div class="sidebar-top">
          <a routerLink="/feed" routerLinkActive="active" class="nav-item"
             [matBadge]="unreadCount > 0 ? unreadCount : null" matBadgeColor="warn" matBadgeSize="small">
            <mat-icon>dynamic_feed</mat-icon>
            <span>Feed</span>
          </a>
          <a routerLink="/chat" routerLinkActive="active" class="nav-item">
            <mat-icon>chat</mat-icon>
            <span>Chat</span>
          </a>
          <a routerLink="/teams" routerLinkActive="active" class="nav-item">
            <mat-icon>groups</mat-icon>
            <span>Teams</span>
          </a>
          <a routerLink="/search" routerLinkActive="active" class="nav-item">
            <mat-icon>search</mat-icon>
            <span>Suche</span>
          </a>
        </div>
        <div class="sidebar-bottom">
          <div class="nav-item user-menu" [matMenuTriggerFor]="userMenu">
            <div class="avatar-wrapper">
              <div class="avatar">
                {{ currentUser?.display_name?.charAt(0)?.toUpperCase() || '?' }}
              </div>
              <span class="status-dot" [class]="currentUser?.status || 'offline'"></span>
            </div>
          </div>
          <mat-menu #userMenu="matMenu">
            <div mat-menu-item disabled class="user-info">
              <strong>{{ currentUser?.display_name }}</strong>
              <br>
              <small>{{ currentUser?.email }}</small>
            </div>
            <mat-divider></mat-divider>
            <div class="status-section-label">Status</div>
            <button mat-menu-item *ngFor="let s of statusOptions"
                    (click)="setStatus(s.value)"
                    [class.active-status]="currentUser?.status === s.value">
              <mat-icon [class]="'status-icon-' + s.value">{{ s.icon }}</mat-icon>
              <span>{{ s.label }}</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="logout()">
              <mat-icon>logout</mat-icon>
              <span>Abmelden</span>
            </button>
          </mat-menu>
        </div>
      </nav>

      <!-- Main Content -->
      <main class="content">
        <router-outlet></router-outlet>
      </main>

      <!-- Incoming Call Overlay -->
      <div class="incoming-call-overlay" *ngIf="incomingCall">
        <div class="incoming-call-card">
          <div class="incoming-call-avatar">
            {{ incomingCall.displayName?.charAt(0)?.toUpperCase() || '?' }}
          </div>
          <div class="incoming-call-info">
            <span class="incoming-call-name">{{ incomingCall.displayName }}</span>
            <span class="incoming-call-label">{{ incomingCall.audioOnly ? 'Audioanruf' : 'Videoanruf' }}...</span>
          </div>
          <div class="incoming-call-actions">
            <button mat-fab color="primary" (click)="acceptCall()" class="call-btn accept">
              <mat-icon>call</mat-icon>
            </button>
            <button mat-fab color="warn" (click)="rejectCall()" class="call-btn reject">
              <mat-icon>call_end</mat-icon>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .layout {
      display: flex;
      height: 100vh;
    }
    .sidebar {
      width: 68px;
      background: var(--bg-dark);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 8px 0;
    }
    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 0;
      color: #b3b0ad;
      text-decoration: none;
      font-size: 10px;
      cursor: pointer;
      transition: color 0.2s;
    }
    .nav-item:hover, .nav-item.active {
      color: white;
      background: rgba(255,255,255,0.1);
    }
    .nav-item.active {
      border-left: 3px solid var(--primary);
    }
    .nav-item mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      margin-bottom: 4px;
    }
    .avatar-wrapper {
      position: relative;
      display: inline-block;
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
      font-size: 14px;
    }
    .status-dot {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--bg-dark);
    }
    .status-dot.online { background: var(--online); }
    .status-dot.busy { background: var(--busy); }
    .status-dot.away { background: var(--away); }
    .status-dot.dnd { background: var(--busy); }
    .status-dot.offline { background: var(--offline); }
    .content {
      flex: 1;
      overflow: hidden;
      background: #f5f5f5;
    }
    .user-info {
      padding: 8px 16px;
      line-height: 1.5;
    }
    .status-section-label {
      padding: 8px 16px 4px;
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .active-status {
      background: rgba(98, 0, 238, 0.08);
    }
    .status-icon-online { color: var(--online) !important; }
    .status-icon-busy { color: var(--busy) !important; }
    .status-icon-away { color: var(--away) !important; }
    .status-icon-dnd { color: var(--busy) !important; }
    .status-icon-offline { color: var(--offline) !important; }
    /* Incoming call overlay */
    .incoming-call-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    .incoming-call-card {
      background: #292929;
      border-radius: 16px;
      padding: 32px 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
      animation: pulse 2s ease-in-out infinite;
      min-width: 280px;
    }
    .incoming-call-avatar {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #6264a7;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 600;
    }
    .incoming-call-info {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .incoming-call-name {
      color: white;
      font-size: 20px;
      font-weight: 600;
    }
    .incoming-call-label {
      color: #aaa;
      font-size: 14px;
    }
    .incoming-call-actions {
      display: flex;
      gap: 24px;
      margin-top: 8px;
    }
    .call-btn { width: 56px !important; height: 56px !important; }
    .call-btn.accept { background: #4caf50 !important; }
  `],
})
export class LayoutComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  unreadCount = 0;
  statusOptions: { value: UserStatus; label: string; icon: string }[] = [];
  incomingCall: { displayName: string; channelId: string; audioOnly: boolean; fromUserId: string } | null = null;
  private subscriptions: Subscription[] = [];
  private ringContext: AudioContext | null = null;
  private ringTimeout: any = null;
  private ringInterval: any = null;
  private initAudioHandler = () => this.initAudioContext();

  constructor(
    private authService: AuthService,
    private apiService: ApiService,
    private wsService: WebSocketService,
    private router: Router,
  ) {
    const allStatuses: UserStatus[] = ['online', 'busy', 'away', 'dnd', 'offline'];
    this.statusOptions = allStatuses.map((s) => ({
      value: s,
      label: STATUS_LABELS[s],
      icon: STATUS_ICONS[s],
    }));
  }

  ngOnInit(): void {
    this.subscriptions.push(
      this.authService.currentUser$.subscribe((user) => {
        this.currentUser = user;
      })
    );

    // Poll unread count every 10 seconds
    this.subscriptions.push(
      interval(10000).pipe(
        switchMap(() => this.apiService.getUnreadCount())
      ).subscribe((res) => {
        this.unreadCount = res.unread_count;
      })
    );

    // Initial load
    this.apiService.getUnreadCount().subscribe((res) => {
      this.unreadCount = res.unread_count;
    });

    // Pre-initialize AudioContext on first user gesture (required by browsers)
    document.addEventListener('click', this.initAudioHandler, { once: true });
    document.addEventListener('keydown', this.initAudioHandler, { once: true });

    // Listen for incoming call invites from ANY WebSocket connection
    this.subscriptions.push(
      this.wsService.globalMessages$.subscribe((msg) => {
        if (msg.type === 'video_call_invite' && !this.incomingCall) {
          this.incomingCall = {
            displayName: msg.display_name,
            channelId: msg.channel_id,
            audioOnly: msg.audio_only,
            fromUserId: msg.from_user_id,
          };
          this.startRinging();
          // Auto-dismiss after 30 seconds
          this.ringTimeout = setTimeout(() => this.rejectCall(), 30000);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.stopRinging();
    document.removeEventListener('click', this.initAudioHandler);
    document.removeEventListener('keydown', this.initAudioHandler);
  }

  setStatus(status: UserStatus): void {
    this.apiService.updateProfile({ status }).subscribe(() => {
      this.authService.updateLocalUser({ status });
    });
    // Also broadcast via any open WS connections
    this.wsService.broadcastStatus(status);
  }

  acceptCall(): void {
    if (!this.incomingCall) return;
    const { channelId, audioOnly } = this.incomingCall;
    this.stopRinging();
    this.incomingCall = null;
    const queryParams = audioOnly ? { audio: 'true' } : {};
    this.router.navigate(['/video', channelId], { queryParams });
  }

  rejectCall(): void {
    this.stopRinging();
    this.incomingCall = null;
  }

  private initAudioContext(): void {
    if (!this.ringContext) {
      try {
        this.ringContext = new AudioContext();
      } catch {
        // Audio not available
      }
    }
  }

  private startRinging(): void {
    // Only play audio if user has already interacted with the page
    // (AudioContext must be created/resumed from a user gesture).
    // The visual overlay is always shown regardless.
    if (!this.ringContext) return;

    this.ringContext.resume().then(() => {
      this.playRingTone();
    }).catch(() => {});
  }

  private playRingTone(): void {
    if (!this.ringContext || this.ringContext.state === 'closed' || !this.incomingCall) return;
    const ctx = this.ringContext;

    // Two-tone ring: 440Hz + 480Hz for 1s, silence 2s, repeat
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    gain.gain.value = 0.15;

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.stop(ctx.currentTime + 1);
    osc2.start();
    osc1.stop(ctx.currentTime + 1);

    // Schedule next ring after 3 seconds total (1s ring + 2s silence)
    this.ringInterval = setTimeout(() => this.playRingTone(), 3000);
  }

  private stopRinging(): void {
    clearTimeout(this.ringTimeout);
    clearTimeout(this.ringInterval);
    this.ringTimeout = null;
    this.ringInterval = null;
    // Suspend instead of close so we can reuse the context for future calls
    if (this.ringContext && this.ringContext.state === 'running') {
      this.ringContext.suspend().catch(() => {});
    }
  }

  logout(): void {
    this.authService.logout();
  }
}
