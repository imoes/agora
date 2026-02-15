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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Subscription, Subject, interval, of } from 'rxjs';
import { switchMap, filter, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AuthService, User, UserStatus, STATUS_LABELS, STATUS_ICONS } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatBadgeModule, MatButtonModule, MatMenuModule, MatTooltipModule, MatDividerModule,
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
          <a routerLink="/calendar" routerLinkActive="active" class="nav-item"
             [matBadge]="pendingInvitationsCount > 0 ? pendingInvitationsCount : null" matBadgeColor="accent" matBadgeSize="small">
            <mat-icon>calendar_today</mat-icon>
            <span>Kalender</span>
          </a>
          <a *ngIf="currentUser?.is_admin" routerLink="/admin" routerLinkActive="active" class="nav-item">
            <mat-icon>admin_panel_settings</mat-icon>
            <span>Admin</span>
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

      <!-- Main wrapper (top bar + body) -->
      <div class="main-wrapper">
        <!-- Top bar with search -->
        <div class="top-bar">
          <div class="search-wrapper" #searchWrapper>
            <mat-icon class="search-icon">search</mat-icon>
            <input type="text" class="search-input" placeholder="Benutzer suchen..."
                   [(ngModel)]="searchQuery" (input)="onSearchInput()" (focus)="onSearchFocus()">
            <mat-icon *ngIf="searchQuery" class="search-clear" (click)="clearSearch()">close</mat-icon>
            <!-- Search dropdown -->
            <div class="search-dropdown" *ngIf="showSearchDropdown && (searchResults.length > 0 || (searchQuery.length >= 2 && !searchLoading))">
              <div *ngFor="let user of searchResults" class="search-result-item" (click)="startChatFromSearch(user)">
                <div class="search-result-avatar">{{ user.display_name?.charAt(0)?.toUpperCase() }}</div>
                <div class="search-result-info">
                  <span class="search-result-name">{{ user.display_name }}</span>
                  <span class="search-result-username">{{'@' + user.username}}</span>
                </div>
                <div class="search-result-actions">
                  <button mat-icon-button (click)="callUserFromSearch(user, true, $event)" matTooltip="Audioanruf" class="search-action-btn">
                    <mat-icon>call</mat-icon>
                  </button>
                  <button mat-icon-button (click)="callUserFromSearch(user, false, $event)" matTooltip="Videoanruf" class="search-action-btn">
                    <mat-icon>videocam</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Chat starten" class="search-action-btn">
                    <mat-icon>chat</mat-icon>
                  </button>
                </div>
              </div>
              <div *ngIf="searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading" class="search-empty">
                Keine Benutzer gefunden
              </div>
            </div>
          </div>
        </div>

        <div class="main-body">
          <!-- Chat Sidebar -->
          <aside class="chat-sidebar">
            <div class="chat-sidebar-header">
              <span>{{ sidebarMode === 'teams' ? 'Teams' : 'Chats' }}</span>
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
                   (click)="openChat(ch.id)"
                   (contextmenu)="onChatContextMenu($event, ch)">
                <div class="chat-sidebar-avatar" [class.team]="ch.channel_type === 'team'" [class.meeting]="ch.channel_type === 'meeting'">
                  <mat-icon *ngIf="ch.channel_type === 'team'">tag</mat-icon>
                  <mat-icon *ngIf="ch.channel_type === 'meeting'">event</mat-icon>
                  <span *ngIf="ch.channel_type !== 'team' && ch.channel_type !== 'meeting'">{{ ch.name?.charAt(0)?.toUpperCase() }}</span>
                </div>
                <div class="chat-sidebar-info">
                  <span class="chat-sidebar-name">{{ ch.team_name ? ch.team_name + ' / ' : '' }}{{ ch.name }}</span>
                  <span class="chat-sidebar-meta" *ngIf="ch.channel_type !== 'meeting'">{{ ch.member_count }} Mitglieder</span>
                  <span class="chat-sidebar-meta" *ngIf="ch.channel_type === 'meeting' && ch.scheduled_at">{{ ch.scheduled_at | date:'dd.MM.yyyy HH:mm' }}</span>
                </div>
                <span *ngIf="ch.unread_count > 0" class="chat-unread-badge">{{ ch.unread_count }}</span>
              </div>
              <div *ngIf="filteredChannels.length === 0" class="chat-sidebar-empty">
                {{ sidebarMode === 'teams' ? 'Keine Team-Chats' : 'Keine Chats' }}
              </div>
            </div>
          </aside>

          <!-- Context Menu -->
          <div class="context-menu" *ngIf="contextMenu.show"
               [style.top.px]="contextMenu.y" [style.left.px]="contextMenu.x">
            <button class="context-menu-item delete" (click)="deleteChat()">
              <mat-icon>delete</mat-icon>
              <span>Chat loeschen</span>
            </button>
          </div>

          <!-- Main Content -->
          <main class="content">
            <router-outlet></router-outlet>
          </main>
        </div>
      </div>

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
    .chat-sidebar-avatar.meeting {
      border-radius: 4px;
      background: #e65100;
    }
    .header-actions {
      display: flex;
      gap: 0;
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
    /* Main wrapper & top bar */
    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .top-bar {
      height: 48px;
      background: var(--bg-dark);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      flex-shrink: 0;
    }
    .search-wrapper {
      position: relative;
      width: 100%;
      max-width: 480px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #999;
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      padding: 7px 32px 7px 34px;
      border: none;
      border-radius: 4px;
      background: rgba(255,255,255,0.12);
      color: white;
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
    }
    .search-input::placeholder { color: #aaa; }
    .search-input:focus { background: rgba(255,255,255,0.2); }
    .search-clear {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #aaa;
      cursor: pointer;
    }
    .search-clear:hover { color: white; }
    .search-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      max-height: 320px;
      overflow-y: auto;
      z-index: 100;
    }
    .search-result-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      cursor: pointer;
    }
    .search-result-item:hover { background: var(--hover); }
    .search-result-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .search-result-info {
      flex: 1;
      min-width: 0;
    }
    .search-result-name {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #333;
    }
    .search-result-username {
      font-size: 11px;
      color: #999;
    }
    .search-result-actions {
      display: flex;
      gap: 0;
    }
    .search-action-btn {
      color: #666 !important;
      width: 30px !important;
      height: 30px !important;
      line-height: 30px !important;
    }
    .search-action-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .search-empty {
      padding: 16px;
      text-align: center;
      color: #999;
      font-size: 13px;
    }
    .main-body {
      flex: 1;
      display: flex;
      overflow: hidden;
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
    /* Context menu */
    .context-menu {
      position: fixed;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      z-index: 200;
      min-width: 160px;
      padding: 4px 0;
    }
    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 16px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 13px;
      color: #333;
    }
    .context-menu-item:hover { background: var(--hover); }
    .context-menu-item.delete { color: #d32f2f; }
    .context-menu-item.delete:hover { background: #fbe9e7; }
    .context-menu-item mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class LayoutComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  unreadCount = 0;
  pendingInvitationsCount = 0;
  statusOptions: { value: UserStatus; label: string; icon: string }[] = [];
  incomingCall: { displayName: string; channelId: string; audioOnly: boolean; fromUserId: string } | null = null;
  chatChannels: any[] = [];
  filteredChannels: any[] = [];
  activeChannelId: string | null = null;
  sidebarMode: 'chats' | 'teams' = 'chats';
  showCallSearch = false;
  callSearchQuery = '';
  callSearchResults: any[] = [];
  // Top bar search
  searchQuery = '';
  searchResults: any[] = [];
  searchLoading = false;
  showSearchDropdown = false;
  private searchSubject = new Subject<string>();
  @ViewChild('searchWrapper') searchWrapper!: ElementRef;
  @ViewChild('callSearchPanel') callSearchPanel!: ElementRef;
  // Context menu
  contextMenu = { show: false, x: 0, y: 0, channel: null as any };
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

    // Debounced user search
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((query) => {
        if (query.length < 2) {
          return of([]);
        }
        this.searchLoading = true;
        return this.apiService.searchUsers(query);
      }),
    ).subscribe((users) => {
      this.searchResults = users.filter((u: any) => u.id !== this.currentUser?.id);
      this.searchLoading = false;
    });
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

    // Poll pending calendar invitations every 10 seconds
    this.subscriptions.push(
      interval(10000).pipe(
        switchMap(() => this.apiService.getCalendarInvitationCount())
      ).subscribe((res) => {
        this.pendingInvitationsCount = res.count;
      })
    );
    this.apiService.getCalendarInvitationCount().subscribe((res) => {
      this.pendingInvitationsCount = res.count;
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
        const match = url.match(/\/(?:teams\/)?chat\/([^?/]+)/);
        this.activeChannelId = match ? match[1] : null;
        if (url.startsWith('/teams')) {
          this.sidebarMode = 'teams';
        } else {
          this.sidebarMode = 'chats';
        }
        // Immediately clear unread count for the opened channel
        if (this.activeChannelId) {
          this.clearUnreadForChannel(this.activeChannelId);
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
    const target = event.target as HTMLElement;
    // Close call search if click is outside
    if (this.showCallSearch && this.callSearchPanel?.nativeElement &&
        !this.callSearchPanel.nativeElement.contains(target) &&
        !target.closest('.call-search-btn')) {
      this.showCallSearch = false;
      this.callSearchQuery = '';
      this.callSearchResults = [];
    }
    // Close top-bar search dropdown if click is outside
    if (this.showSearchDropdown && this.searchWrapper?.nativeElement &&
        !this.searchWrapper.nativeElement.contains(target)) {
      this.showSearchDropdown = false;
    }
    // Close context menu on any click
    if (this.contextMenu.show) {
      this.contextMenu.show = false;
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

  // Top bar search methods
  onSearchInput(): void {
    this.searchSubject.next(this.searchQuery);
    this.showSearchDropdown = this.searchQuery.length >= 2;
  }

  onSearchFocus(): void {
    if (this.searchQuery.length >= 2 && this.searchResults.length > 0) {
      this.showSearchDropdown = true;
    }
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.showSearchDropdown = false;
  }

  startChatFromSearch(user: any): void {
    this.apiService.findOrCreateDirectChat(user.id).subscribe((channel) => {
      this.clearSearch();
      this.router.navigate(['/chat', channel.id]);
    });
  }

  callUserFromSearch(user: any, audioOnly: boolean, event: MouseEvent): void {
    event.stopPropagation();
    this.apiService.findOrCreateDirectChat(user.id).subscribe((channel) => {
      this.clearSearch();
      const queryParams = audioOnly ? { audio: 'true' } : {};
      this.router.navigate(['/video', channel.id], { queryParams });
    });
  }

  private clearUnreadForChannel(channelId: string): void {
    const ch = this.chatChannels.find((c) => c.id === channelId);
    if (ch) {
      ch.unread_count = 0;
    }
    const fch = this.filteredChannels.find((c) => c.id === channelId);
    if (fch) {
      fch.unread_count = 0;
    }
  }

  openNewMeeting(): void {
    const name = prompt('Termin-Name:');
    if (!name) return;
    const dateStr = prompt('Datum und Uhrzeit (z.B. 2026-03-15 14:00):');
    if (!dateStr) return;
    const scheduledAt = new Date(dateStr);
    if (isNaN(scheduledAt.getTime())) {
      alert('Ungueltiges Datum');
      return;
    }
    this.apiService.createChannel({
      name,
      channel_type: 'meeting',
      scheduled_at: scheduledAt.toISOString(),
    }).subscribe((channel) => {
      this.loadChatChannels();
      this.router.navigate(['/chat', channel.id]);
    });
  }

  onChatContextMenu(event: MouseEvent, channel: any): void {
    event.preventDefault();
    // Don't allow deleting team channels
    if (channel.channel_type === 'team') return;
    this.contextMenu = {
      show: true,
      x: event.clientX,
      y: event.clientY,
      channel,
    };
  }

  deleteChat(): void {
    if (!this.contextMenu.channel) return;
    const ch = this.contextMenu.channel;
    this.contextMenu.show = false;
    if (confirm(`Chat "${ch.name}" wirklich loeschen?`)) {
      this.apiService.deleteChannel(ch.id).subscribe(() => {
        this.chatChannels = this.chatChannels.filter((c) => c.id !== ch.id);
        this.updateFilteredChannels();
        if (this.activeChannelId === ch.id) {
          this.router.navigate(['/chat']);
        }
      });
    }
  }

  openChat(channelId: string): void {
    if (this.sidebarMode === 'teams') {
      this.router.navigate(['/teams/chat', channelId]);
    } else {
      this.router.navigate(['/chat', channelId]);
    }
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
