import { Component, OnInit, OnDestroy, ElementRef, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { Subscription, interval } from 'rxjs';
import { switchMap, filter } from 'rxjs/operators';
import { AuthService, User, UserStatus, STATUS_LABELS, STATUS_ICONS } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive,
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

      <!-- Chat Sidebar -->
      <aside class="chat-sidebar">
        <div class="chat-sidebar-header">
          <span>{{ sidebarMode === 'teams' ? 'Teams' : 'Chats' }}</span>
          <button mat-icon-button (click)="toggleCallSearch($event)" class="call-search-btn"
                  [class.active]="showCallSearch">
            <mat-icon>add_call</mat-icon>
          </button>
        </div>

        <!-- User search for calling -->
        <div class="call-search-panel" *ngIf="showCallSearch" #callSearchPanel>
          <input class="call-search-input" [(ngModel)]="callSearchQuery"
                 (input)="onCallSearch()" placeholder="Benutzer suchen...">
          <div class="call-search-results">
            <div *ngFor="let u of callSearchResults" class="call-search-item">
              <div class="call-search-avatar">{{ u.display_name?.charAt(0)?.toUpperCase() }}</div>
              <div class="call-search-info">
                <span class="call-search-name">{{ u.display_name }}</span>
                <span class="call-search-username">{{'@' + u.username}}</span>
              </div>
              <button mat-icon-button (click)="callUser(u, false)" matTooltip="Videoanruf" class="call-action-btn">
                <mat-icon>videocam</mat-icon>
              </button>
              <button mat-icon-button (click)="callUser(u, true)" matTooltip="Audioanruf" class="call-action-btn">
                <mat-icon>call</mat-icon>
              </button>
            </div>
            <div *ngIf="callSearchQuery && callSearchResults.length === 0" class="call-search-empty">
              Keine Benutzer gefunden
            </div>
          </div>
        </div>

        <div class="chat-sidebar-list">
          <div *ngFor="let ch of filteredChannels"
               class="chat-sidebar-item"
               [class.active]="activeChannelId === ch.id"
               [class.unread]="ch.unread_count > 0"
               (click)="openChat(ch.id)">
            <div class="chat-sidebar-avatar" [class.team]="ch.channel_type === 'team'">
              <mat-icon *ngIf="ch.channel_type === 'team'">tag</mat-icon>
              <span *ngIf="ch.channel_type !== 'team'">{{ ch.name?.charAt(0)?.toUpperCase() }}</span>
            </div>
            <div class="chat-sidebar-info">
              <span class="chat-sidebar-name">{{ ch.team_name ? ch.team_name + ' / ' : '' }}{{ ch.name }}</span>
              <span class="chat-sidebar-meta">{{ ch.member_count }} Mitglieder</span>
            </div>
            <span *ngIf="ch.unread_count > 0" class="chat-unread-badge">{{ ch.unread_count }}</span>
          </div>
          <div *ngIf="filteredChannels.length === 0" class="chat-sidebar-empty">
            {{ sidebarMode === 'teams' ? 'Keine Team-Chats' : 'Keine Chats' }}
          </div>
        </div>
      </aside>

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
    /* Chat sidebar */
    .chat-sidebar {
      width: 260px;
      background: #fff;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex-shrink: 0;
    }
    .chat-sidebar-header {
      padding: 16px 16px 12px;
      font-size: 16px;
      font-weight: 600;
      color: #333;
      border-bottom: 1px solid var(--border);
    }
    .chat-sidebar-list {
      flex: 1;
      overflow-y: auto;
    }
    .chat-sidebar-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .chat-sidebar-item:hover {
      background: var(--hover);
    }
    .chat-sidebar-item.active {
      background: rgba(98, 0, 238, 0.08);
      border-left: 3px solid var(--primary);
    }
    .chat-sidebar-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .chat-sidebar-avatar.team {
      border-radius: 4px;
    }
    .chat-sidebar-info {
      flex: 1;
      min-width: 0;
    }
    .chat-sidebar-name {
      display: block;
      font-size: 13px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chat-sidebar-item.unread .chat-sidebar-name {
      font-weight: 700;
      color: #000;
    }
    .chat-sidebar-meta {
      display: block;
      font-size: 11px;
      color: #999;
    }
    .chat-unread-badge {
      background: var(--primary);
      color: white;
      border-radius: 10px;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .chat-sidebar-empty {
      padding: 24px 16px;
      text-align: center;
      color: #999;
      font-size: 13px;
    }
    /* Call search */
    .chat-sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .call-search-btn { color: #666; }
    .call-search-btn.active { color: var(--primary); }
    .call-search-panel {
      border-bottom: 1px solid var(--border);
      background: #fafafa;
    }
    .call-search-input {
      width: 100%;
      padding: 10px 16px;
      border: none;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      outline: none;
      background: transparent;
      box-sizing: border-box;
    }
    .call-search-results {
      max-height: 200px;
      overflow-y: auto;
    }
    .call-search-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
    }
    .call-search-item:hover {
      background: var(--hover);
    }
    .call-search-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .call-search-info {
      flex: 1;
      min-width: 0;
    }
    .call-search-name {
      display: block;
      font-size: 13px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .call-search-username {
      font-size: 11px;
      color: #999;
    }
    .call-action-btn {
      color: #666 !important;
      width: 32px !important;
      height: 32px !important;
      line-height: 32px !important;
    }
    .call-action-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .call-search-empty {
      padding: 12px 16px;
      text-align: center;
      color: #999;
      font-size: 12px;
    }
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
  chatChannels: any[] = [];
  filteredChannels: any[] = [];
  activeChannelId: string | null = null;
  sidebarMode: 'chats' | 'teams' = 'chats';
  showCallSearch = false;
  callSearchQuery = '';
  callSearchResults: any[] = [];
  @ViewChild('callSearchPanel') callSearchPanel!: ElementRef;
  private subscriptions: Subscription[] = [];
  private ringAudio: HTMLAudioElement | null = null;
  private ringBlobUrl: string | null = null;
  private ringTimeout: any = null;
  private audioUnlocked = false;
  private unlockHandler = () => this.unlockAudio();

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

    // Pre-create ringtone audio and unlock on first user gesture
    this.prepareRingtone();
    document.addEventListener('click', this.unlockHandler, { once: true });
    document.addEventListener('keydown', this.unlockHandler, { once: true });

    // Load chat channels for sidebar
    this.loadChatChannels();

    // Refresh chat list every 30 seconds
    this.subscriptions.push(
      interval(30000).pipe(
        switchMap(() => this.apiService.getChannels())
      ).subscribe((channels) => {
        this.chatChannels = channels;
        this.updateFilteredChannels();
      })
    );

    // Track active channel and sidebar mode from URL
    this.subscriptions.push(
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd)
      ).subscribe((e) => {
        const url = e.urlAfterRedirects;
        const match = url.match(/\/chat\/([^?/]+)/);
        this.activeChannelId = match ? match[1] : null;
        if (url.startsWith('/teams')) {
          this.sidebarMode = 'teams';
        } else {
          this.sidebarMode = 'chats';
        }
        this.updateFilteredChannels();
      })
    );
    // Set initial sidebar mode from current URL
    if (this.router.url.startsWith('/teams')) {
      this.sidebarMode = 'teams';
    }

    // Connect persistent notification WebSocket (for call invites even when no chat is open)
    this.wsService.connectNotifications();

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
        // Caller cancelled the invite
        if (msg.type === 'video_call_cancel' && this.incomingCall?.fromUserId === msg.from_user_id) {
          this.stopRinging();
          this.incomingCall = null;
        }
        // Refresh chat sidebar on new messages
        if (msg.type === 'new_message') {
          this.loadChatChannels();
        }
      })
    );
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showCallSearch) return;
    const target = event.target as HTMLElement;
    // Close if click is outside the call search panel and its toggle button
    if (this.callSearchPanel?.nativeElement &&
        !this.callSearchPanel.nativeElement.contains(target) &&
        !target.closest('.call-search-btn')) {
      this.showCallSearch = false;
      this.callSearchQuery = '';
      this.callSearchResults = [];
    }
  }

  loadChatChannels(): void {
    this.apiService.getChannels().subscribe((channels) => {
      this.chatChannels = channels;
      this.updateFilteredChannels();
    });
  }

  private updateFilteredChannels(): void {
    if (this.sidebarMode === 'teams') {
      this.filteredChannels = this.chatChannels.filter((ch) => ch.channel_type === 'team');
    } else {
      this.filteredChannels = this.chatChannels.filter((ch) => ch.channel_type !== 'team');
    }
  }

  toggleCallSearch(event: MouseEvent): void {
    event.stopPropagation();
    this.showCallSearch = !this.showCallSearch;
    if (!this.showCallSearch) {
      this.callSearchQuery = '';
      this.callSearchResults = [];
    }
  }

  onCallSearch(): void {
    const q = this.callSearchQuery.trim();
    if (!q) {
      this.callSearchResults = [];
      return;
    }
    this.apiService.searchUsers(q).subscribe((users) => {
      this.callSearchResults = users.filter((u: any) => u.id !== this.currentUser?.id);
    });
  }

  callUser(user: any, audioOnly: boolean): void {
    this.apiService.findOrCreateDirectChat(user.id).subscribe((channel) => {
      this.showCallSearch = false;
      this.callSearchQuery = '';
      this.callSearchResults = [];
      const queryParams = audioOnly ? { audio: 'true' } : {};
      this.router.navigate(['/video', channel.id], { queryParams });
    });
  }

  openChat(channelId: string): void {
    this.router.navigate(['/chat', channelId]);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.stopRinging();
    this.wsService.disconnectNotifications();
    document.removeEventListener('click', this.unlockHandler);
    document.removeEventListener('keydown', this.unlockHandler);
    if (this.ringBlobUrl) {
      URL.revokeObjectURL(this.ringBlobUrl);
    }
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

  /** Pre-create the ringtone Audio element so it's ready when needed. */
  private prepareRingtone(): void {
    try {
      const blob = this.createRingtoneWav();
      this.ringBlobUrl = URL.createObjectURL(blob);
      this.ringAudio = new Audio(this.ringBlobUrl);
      this.ringAudio.loop = true;
    } catch {
      // Audio not available
    }
  }

  /** Unlock audio playback during a user gesture (click/keydown).
   *  Browsers require at least one play() from a gesture before allowing
   *  programmatic playback (e.g. from a WebSocket handler). */
  private unlockAudio(): void {
    if (this.audioUnlocked || !this.ringAudio) return;
    this.ringAudio.volume = 0;
    this.ringAudio.play().then(() => {
      this.ringAudio!.pause();
      this.ringAudio!.currentTime = 0;
      this.ringAudio!.volume = 1;
      this.audioUnlocked = true;
    }).catch(() => {});
  }

  private startRinging(): void {
    if (!this.ringAudio) return;
    this.ringAudio.currentTime = 0;
    this.ringAudio.play().catch(() => {});
  }

  private stopRinging(): void {
    clearTimeout(this.ringTimeout);
    this.ringTimeout = null;
    if (this.ringAudio) {
      this.ringAudio.pause();
      this.ringAudio.currentTime = 0;
    }
  }

  /** Generate a 3-second WAV (1s dual-tone ring + 2s silence) as a Blob. */
  private createRingtoneWav(): Blob {
    const sampleRate = 44100;
    const duration = 3;
    const numSamples = sampleRate * duration;
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buffer);

    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, 'data');
    v.setUint32(40, dataSize, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      if (t < 1.0) {
        sample = 0.15 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t));
      }
      v.setInt16(44 + i * 2, sample * 32767, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  logout(): void {
    this.authService.logout();
  }
}
