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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription, Subject, interval, of } from 'rxjs';
import { switchMap, filter, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AuthService, User, UserStatus, STATUS_LABELS, STATUS_ICONS } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';
import { WebSocketService } from '@services/websocket.service';
import { I18nService, EU_LANGUAGES } from '@services/i18n.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatBadgeModule, MatButtonModule, MatMenuModule, MatTooltipModule, MatDividerModule,
    MatFormFieldModule, MatInputModule, MatSnackBarModule,
  ],
  template: `
    <div class="layout">
      <!-- Sidebar -->
      <nav class="sidebar">
        <div class="sidebar-top">
          <a routerLink="/feed" routerLinkActive="active" class="nav-item"
             [matBadge]="unreadCount > 0 ? unreadCount : null" matBadgeColor="warn" matBadgeSize="small">
            <mat-icon>dynamic_feed</mat-icon>
            <span>{{ i18n.t('nav.feed') }}</span>
          </a>
          <a routerLink="/chat" routerLinkActive="active" class="nav-item"
             [matBadge]="chatUnreadCount > 0 ? chatUnreadCount : null" matBadgeColor="warn" matBadgeSize="small">
            <mat-icon>chat</mat-icon>
            <span>{{ i18n.t('nav.chat') }}</span>
          </a>
          <a routerLink="/teams" routerLinkActive="active" class="nav-item"
             [matBadge]="teamsUnreadCount > 0 ? teamsUnreadCount : null" matBadgeColor="warn" matBadgeSize="small">
            <mat-icon>groups</mat-icon>
            <span>{{ i18n.t('nav.teams') }}</span>
          </a>
          <a routerLink="/calendar" routerLinkActive="active" class="nav-item"
             [matBadge]="pendingInvitationsCount > 0 ? pendingInvitationsCount : null" matBadgeColor="accent" matBadgeSize="small">
            <mat-icon>calendar_today</mat-icon>
            <span>{{ i18n.t('nav.calendar') }}</span>
          </a>
          <a *ngIf="currentUser?.is_admin" routerLink="/admin" routerLinkActive="active" class="nav-item">
            <mat-icon>admin_panel_settings</mat-icon>
            <span>{{ i18n.t('nav.admin') }}</span>
          </a>
        </div>
        <div class="sidebar-bottom">
          <div class="nav-item user-menu" [matMenuTriggerFor]="userMenu">
            <div class="avatar-wrapper">
              <div class="avatar">
                <img *ngIf="currentUser?.avatar_path" [src]="getAvatarUrl(currentUser?.avatar_path)" class="avatar-img-nav" alt="">
                <span *ngIf="!currentUser?.avatar_path">{{ currentUser?.display_name?.charAt(0)?.toUpperCase() || '?' }}</span>
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
            <div class="status-section-label">{{ i18n.t('status.label') }}</div>
            <button mat-menu-item *ngFor="let s of statusOptions"
                    (click)="setStatus(s.value)"
                    [class.active-status]="currentUser?.status === s.value">
              <mat-icon [class]="'status-icon-' + s.value">{{ s.icon }}</mat-icon>
              <span>{{ i18n.t('status.' + s.value) }}</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="openProfileSettings()">
              <mat-icon>account_circle</mat-icon>
              <span>{{ i18n.t('menu.profile') }}</span>
            </button>
            <button mat-menu-item [matMenuTriggerFor]="deviceMenu">
              <mat-icon>settings</mat-icon>
              <span>{{ i18n.t('menu.device_settings') }}</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="logout()">
              <mat-icon>logout</mat-icon>
              <span>{{ i18n.t('menu.logout') }}</span>
            </button>
          </mat-menu>

          <mat-menu #deviceMenu="matMenu" class="device-menu">
            <div class="device-section" (click)="$event.stopPropagation()">
              <div class="device-section-label">
                <mat-icon>mic</mat-icon>
                {{ i18n.t('menu.microphone') }}
              </div>
              <select class="device-select" [value]="selectedAudioInput"
                      (change)="onAudioInputChange($event)">
                <option value="">{{ i18n.t('menu.default') }}</option>
                <option *ngFor="let d of audioInputDevices" [value]="d.deviceId">{{ d.label || 'Mikrofon ' + d.deviceId.slice(0, 5) }}</option>
              </select>
            </div>
            <mat-divider></mat-divider>
            <div class="device-section" (click)="$event.stopPropagation()">
              <div class="device-section-label">
                <mat-icon>videocam</mat-icon>
                {{ i18n.t('menu.camera') }}
              </div>
              <select class="device-select" [value]="selectedVideoInput"
                      (change)="onVideoInputChange($event)">
                <option value="">{{ i18n.t('menu.default') }}</option>
                <option *ngFor="let d of videoInputDevices" [value]="d.deviceId">{{ d.label || 'Kamera ' + d.deviceId.slice(0, 5) }}</option>
              </select>
            </div>
            <mat-divider></mat-divider>
            <div class="device-section" (click)="$event.stopPropagation()">
              <div class="device-section-label">
                <mat-icon>volume_up</mat-icon>
                {{ i18n.t('menu.speaker') }}
              </div>
              <select class="device-select" [value]="selectedAudioOutput"
                      (change)="onAudioOutputChange($event)">
                <option value="">{{ i18n.t('menu.default') }}</option>
                <option *ngFor="let d of audioOutputDevices" [value]="d.deviceId">{{ d.label || 'Lautsprecher ' + d.deviceId.slice(0, 5) }}</option>
              </select>
            </div>
          </mat-menu>
        </div>
      </nav>

      <!-- Main wrapper (top bar + body) -->
      <div class="main-wrapper">
        <!-- Top bar with search -->
        <div class="top-bar">
          <div class="search-wrapper" #searchWrapper>
            <mat-icon class="search-icon">search</mat-icon>
            <input type="text" class="search-input" [placeholder]="i18n.t('search.placeholder')"
                   [(ngModel)]="searchQuery" (input)="onSearchInput()" (focus)="onSearchFocus()">
            <mat-icon *ngIf="searchQuery" class="search-clear" (click)="clearSearch()">close</mat-icon>
            <!-- Search dropdown -->
            <div class="search-dropdown" *ngIf="showSearchDropdown && (searchResults.length > 0 || (searchQuery.length >= 2 && !searchLoading))">
              <div *ngFor="let user of searchResults" class="search-result-item" (click)="startChatFromSearch(user)">
                <div class="search-result-avatar-wrapper">
                  <div class="search-result-avatar">
                    <img *ngIf="user.avatar_path" [src]="getAvatarUrl(user.avatar_path)" class="search-avatar-img" alt="">
                    <span *ngIf="!user.avatar_path">{{ user.display_name?.charAt(0)?.toUpperCase() }}</span>
                  </div>
                  <span class="search-status-dot" [class]="user.status || 'offline'"></span>
                </div>
                <div class="search-result-info">
                  <span class="search-result-name">{{ user.display_name }}</span>
                  <span class="search-result-username">{{'@' + user.username}}</span>
                </div>
                <div class="search-result-actions">
                  <button mat-icon-button (click)="callUserFromSearch(user, true, $event)" [matTooltip]="i18n.t('search.audio_call')" class="search-action-btn">
                    <mat-icon>call</mat-icon>
                  </button>
                  <button mat-icon-button (click)="callUserFromSearch(user, false, $event)" [matTooltip]="i18n.t('search.video_call')" class="search-action-btn">
                    <mat-icon>videocam</mat-icon>
                  </button>
                  <button mat-icon-button [matTooltip]="i18n.t('search.start_chat')" class="search-action-btn">
                    <mat-icon>chat</mat-icon>
                  </button>
                </div>
              </div>
              <div *ngIf="searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading" class="search-empty">
                {{ i18n.t('search.no_results') }}
              </div>
            </div>
          </div>
        </div>

        <div class="main-body">
          <!-- Chat Sidebar -->
          <aside class="chat-sidebar">
            <div class="chat-sidebar-header">
              <span>{{ sidebarMode === 'teams' ? i18n.t('nav.teams') : i18n.t('chat.chats') }}</span>
            </div>

            <!-- User search for calling -->
            <div class="call-search-panel" *ngIf="showCallSearch" #callSearchPanel>
              <input class="call-search-input" [(ngModel)]="callSearchQuery"
                     (input)="onCallSearch()" [placeholder]="i18n.t('search.placeholder')">
              <div class="call-search-results">
                <div *ngFor="let u of callSearchResults" class="call-search-item">
                  <div class="call-search-avatar-wrapper">
                    <div class="call-search-avatar">
                      <img *ngIf="u.avatar_path" [src]="getAvatarUrl(u.avatar_path)" class="call-avatar-img" alt="">
                      <span *ngIf="!u.avatar_path">{{ u.display_name?.charAt(0)?.toUpperCase() }}</span>
                    </div>
                    <span class="call-status-dot" [class]="u.status || 'offline'"></span>
                  </div>
                  <div class="call-search-info">
                    <span class="call-search-name">{{ u.display_name }}</span>
                    <span class="call-search-username">{{'@' + u.username}}</span>
                  </div>
                  <button mat-icon-button (click)="callUser(u, false)" [matTooltip]="i18n.t('search.video_call')" class="call-action-btn">
                    <mat-icon>videocam</mat-icon>
                  </button>
                  <button mat-icon-button (click)="callUser(u, true)" [matTooltip]="i18n.t('search.audio_call')" class="call-action-btn">
                    <mat-icon>call</mat-icon>
                  </button>
                </div>
                <div *ngIf="callSearchQuery && callSearchResults.length === 0" class="call-search-empty">
                  {{ i18n.t('search.no_results') }}
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
                  <span class="chat-sidebar-meta" *ngIf="ch.channel_type !== 'meeting'">{{ ch.member_count }} {{ i18n.t('chat.members') }}</span>
                  <span class="chat-sidebar-meta" *ngIf="ch.channel_type === 'meeting' && ch.scheduled_at">{{ ch.scheduled_at | date:'dd.MM.yyyy HH:mm' }}</span>
                </div>
                <span *ngIf="ch.unread_count > 0" class="chat-unread-badge">{{ ch.unread_count }}</span>
              </div>
              <div *ngIf="filteredChannels.length === 0" class="chat-sidebar-empty">
                {{ sidebarMode === 'teams' ? i18n.t('chat.no_team_chats') : i18n.t('chat.no_chats_available') }}
              </div>
            </div>
          </aside>

          <!-- Context Menu -->
          <div class="context-menu" *ngIf="contextMenu.show"
               [style.top.px]="contextMenu.y" [style.left.px]="contextMenu.x">
            <button class="context-menu-item" (click)="renameChat()">
              <mat-icon>edit</mat-icon>
              <span>{{ i18n.t('chat.rename') }}</span>
            </button>
            <button class="context-menu-item delete" (click)="deleteChat()">
              <mat-icon>delete</mat-icon>
              <span>{{ i18n.t('chat.delete_chat') }}</span>
            </button>
          </div>

          <!-- Main Content -->
          <main class="content">
            <router-outlet></router-outlet>
          </main>
        </div>
      </div>

      <!-- Profile Settings Modal -->
      <div class="profile-overlay" *ngIf="showProfileSettings" (click)="showProfileSettings = false">
        <div class="profile-card" (click)="$event.stopPropagation()">
          <div class="profile-header">
            <h3>{{ i18n.t('profile.title') }}</h3>
            <button mat-icon-button (click)="showProfileSettings = false">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="profile-form">
            <div class="avatar-upload-section">
              <div class="avatar-preview" (click)="avatarFileInput.click()">
                <img *ngIf="currentUser?.avatar_path" [src]="getAvatarUrl(currentUser?.avatar_path)" class="avatar-img" alt="Avatar">
                <span *ngIf="!currentUser?.avatar_path" class="avatar-initials">{{ currentUser?.display_name?.charAt(0)?.toUpperCase() || '?' }}</span>
                <div class="avatar-overlay"><mat-icon>photo_camera</mat-icon></div>
              </div>
              <input type="file" accept="image/*" #avatarFileInput hidden (change)="onAvatarSelected($event)">
              <span class="avatar-hint">{{ i18n.t('profile.avatar_hint') }}</span>
            </div>
            <mat-form-field appearance="outline" class="profile-field">
              <mat-label>{{ i18n.t('profile.display_name') }}</mat-label>
              <input matInput [(ngModel)]="profileForm.display_name">
            </mat-form-field>
            <mat-form-field appearance="outline" class="profile-field">
              <mat-label>{{ i18n.t('profile.email') }}</mat-label>
              <input matInput type="email" [(ngModel)]="profileForm.email">
            </mat-form-field>
            <div class="profile-actions">
              <button mat-raised-button color="primary" (click)="saveProfile()" [disabled]="savingProfile">
                {{ i18n.t('admin.save') }}
              </button>
            </div>
            <mat-divider></mat-divider>
            <h4>{{ i18n.t('profile.change_password') }}</h4>
            <mat-form-field appearance="outline" class="profile-field">
              <mat-label>{{ i18n.t('profile.current_password') }}</mat-label>
              <input matInput type="password" [(ngModel)]="profileForm.current_password">
            </mat-form-field>
            <mat-form-field appearance="outline" class="profile-field">
              <mat-label>{{ i18n.t('profile.new_password') }}</mat-label>
              <input matInput type="password" [(ngModel)]="profileForm.new_password">
            </mat-form-field>
            <mat-form-field appearance="outline" class="profile-field">
              <mat-label>{{ i18n.t('profile.confirm_password') }}</mat-label>
              <input matInput type="password" [(ngModel)]="profileForm.confirm_password">
            </mat-form-field>
            <div class="profile-actions">
              <button mat-raised-button color="primary" (click)="changePassword()" [disabled]="savingProfile">
                {{ i18n.t('profile.change_password') }}
              </button>
            </div>
            <mat-divider></mat-divider>
            <h4><mat-icon class="section-icon">notifications</mat-icon> {{ i18n.t('profile.notification_sound') }}</h4>
            <div class="notification-sound-section">
              <div class="notification-sound-info">
                <mat-icon class="sound-status-icon">{{ currentUser?.notification_sound_path ? 'music_note' : 'volume_up' }}</mat-icon>
                <span class="sound-label">{{ currentUser?.notification_sound_path ? i18n.t('profile.notification_sound_custom') : i18n.t('profile.notification_sound_default') }}</span>
              </div>
              <div class="notification-sound-actions">
                <button mat-stroked-button (click)="testNotificationSound()" class="sound-btn">
                  <mat-icon>play_arrow</mat-icon>
                  {{ i18n.t('profile.test_sound') }}
                </button>
                <button mat-stroked-button (click)="soundFileInput.click()" class="sound-btn">
                  <mat-icon>upload</mat-icon>
                  {{ i18n.t('profile.notification_sound_hint') }}
                </button>
                <button mat-stroked-button *ngIf="currentUser?.notification_sound_path"
                        (click)="resetNotificationSound()" class="sound-btn">
                  <mat-icon>restart_alt</mat-icon>
                  {{ i18n.t('profile.reset_sound') }}
                </button>
              </div>
              <input type="file" accept="audio/*" #soundFileInput hidden (change)="onNotificationSoundSelected($event)">
            </div>
            <mat-divider></mat-divider>
            <h4><mat-icon class="section-icon">language</mat-icon> {{ i18n.t('menu.language') }}</h4>
            <div class="language-grid">
              <button *ngFor="let lang of availableLanguages"
                      class="language-chip"
                      [class.active]="i18n.lang === lang.code"
                      (click)="setLanguage(lang.code)">
                {{ lang.nativeName }}
              </button>
            </div>
          </div>
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
            <span class="incoming-call-label">{{ incomingCall.audioOnly ? i18n.t('incoming_call.audio') : i18n.t('incoming_call.video') }}</span>
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

      <!-- Event Reminder Popup -->
      <div class="event-reminder-popup" *ngIf="reminderEvent">
        <div class="reminder-icon-row">
          <mat-icon class="reminder-bell">notifications_active</mat-icon>
        </div>
        <div class="reminder-title">{{ reminderEvent.title }}</div>
        <div class="reminder-time">
          {{ formatReminderTime(reminderEvent.start_time) }}
        </div>
        <div class="reminder-countdown">
          {{ i18n.t('reminder.starts_in') }} {{ reminderCountdown }}
        </div>
        <div class="reminder-actions">
          <button class="reminder-btn reminder-btn-join" *ngIf="reminderEvent.channel_id"
                  (click)="joinRemindedEvent()">
            <mat-icon>videocam</mat-icon>
            {{ i18n.t('reminder.join') }}
          </button>
          <button class="reminder-btn reminder-btn-dismiss" (click)="dismissReminder()">
            {{ i18n.t('reminder.dismiss') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .layout {
      display: flex;
      height: 100vh;
      height: 100dvh;
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
    .call-search-avatar-wrapper {
      position: relative;
      flex-shrink: 0;
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
      overflow: hidden;
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
    .search-result-avatar-wrapper {
      position: relative;
      flex-shrink: 0;
    }
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
      overflow: hidden;
    }
    .search-avatar-img, .call-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .search-status-dot, .call-status-dot {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid white;
    }
    .search-status-dot.online, .call-status-dot.online { background: var(--online); }
    .search-status-dot.busy, .call-status-dot.busy { background: var(--busy); }
    .search-status-dot.away, .call-status-dot.away { background: var(--away); }
    .search-status-dot.dnd, .call-status-dot.dnd { background: var(--busy); }
    .search-status-dot.offline, .call-status-dot.offline { background: var(--offline); }
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
    /* Device settings */
    .device-section {
      padding: 8px 16px;
    }
    .device-section-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .device-section-label mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .device-select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
      background: white;
      cursor: pointer;
      outline: none;
      max-width: 250px;
    }
    .device-select:focus {
      border-color: var(--primary);
    }

    /* Profile settings modal */
    .profile-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .profile-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      width: 400px;
      max-width: 90vw;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .profile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .profile-header h3 { margin: 0; color: #333; }
    .profile-form { display: flex; flex-direction: column; gap: 4px; }
    .profile-form h4 { margin: 12px 0 4px 0; color: #333; display: flex; align-items: center; gap: 6px; }
    .profile-form h4 .section-icon { font-size: 20px; width: 20px; height: 20px; color: #666; }
    .notification-sound-section {
      display: flex; flex-direction: column; gap: 8px; margin: 8px 0 4px;
    }
    .notification-sound-info {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      background: #f5f5f5; border-radius: 8px;
    }
    .sound-status-icon { color: #1976d2; }
    .sound-label { font-size: 14px; color: #333; }
    .notification-sound-actions {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .sound-btn { font-size: 12px !important; }
    .language-grid {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; max-height: 200px; overflow-y: auto;
    }
    .language-chip {
      padding: 4px 12px; border-radius: 16px; border: 1px solid #ddd;
      background: #f5f5f5; cursor: pointer; font-size: 13px; transition: all 0.15s;
    }
    .language-chip:hover { background: #e0e0e0; }
    .language-chip.active { background: #1976d2; color: white; border-color: #1976d2; }
    .profile-field { width: 100%; }
    .profile-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 8px;
    }
    .avatar-upload-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    .avatar-preview {
      position: relative;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      cursor: pointer;
      overflow: hidden;
      background: var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .avatar-preview .avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar-preview .avatar-initials {
      color: white;
      font-size: 28px;
      font-weight: 600;
    }
    .avatar-preview .avatar-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;
      color: white;
    }
    .avatar-preview:hover .avatar-overlay {
      opacity: 1;
    }
    .avatar-hint {
      font-size: 11px;
      color: #999;
    }
    .avatar-img-nav {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }

    /* Event reminder popup */
    .event-reminder-popup {
      position: fixed;
      top: 24px;
      right: 24px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      padding: 20px 24px;
      z-index: 1100;
      min-width: 280px;
      max-width: 360px;
      animation: slideInRight 0.3s ease;
      border-left: 4px solid var(--primary);
    }
    @keyframes slideInRight {
      from { opacity: 0; transform: translateX(40px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .reminder-icon-row {
      margin-bottom: 8px;
    }
    .reminder-bell {
      color: #e65100;
      font-size: 28px;
      width: 28px;
      height: 28px;
      animation: bellShake 0.6s ease-in-out 0s 2;
    }
    @keyframes bellShake {
      0%, 100% { transform: rotate(0); }
      15% { transform: rotate(14deg); }
      30% { transform: rotate(-14deg); }
      45% { transform: rotate(10deg); }
      60% { transform: rotate(-6deg); }
      75% { transform: rotate(2deg); }
    }
    .reminder-title {
      font-size: 15px;
      font-weight: 600;
      color: #333;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .reminder-time {
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
    }
    .reminder-countdown {
      font-size: 20px;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 14px;
    }
    .reminder-actions {
      display: flex;
      gap: 8px;
    }
    .reminder-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .reminder-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .reminder-btn-join {
      background: var(--primary);
      color: white;
      flex: 1;
      justify-content: center;
    }
    .reminder-btn-join:hover {
      background: var(--primary-dark);
    }
    .reminder-btn-dismiss {
      background: #e0e0e0;
      color: #333;
    }
    .reminder-btn-dismiss:hover {
      background: #d0d0d0;
    }

    /* ============ Mobile responsive ============ */
    @media (max-width: 768px) {
      .layout {
        flex-direction: column;
      }
      .sidebar {
        order: 2;
        width: 100%;
        height: 56px;
        flex-direction: row;
        padding: 0;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 100;
        border-top: 1px solid rgba(255,255,255,0.1);
      }
      .sidebar-top {
        display: flex;
        flex-direction: row;
        flex: 1;
        justify-content: space-around;
        align-items: center;
      }
      .sidebar-bottom {
        display: flex;
        align-items: center;
        padding: 0 8px;
      }
      .nav-item {
        padding: 6px 0;
        font-size: 9px;
        min-width: 48px;
      }
      .nav-item.active {
        border-left: none;
        border-top: 2px solid var(--primary);
      }
      .nav-item mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        margin-bottom: 2px;
      }
      .main-wrapper {
        order: 1;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 56px;
        padding-bottom: 0;
      }
      .top-bar {
        height: 44px;
        padding: 0 8px;
      }
      .search-wrapper {
        max-width: 100%;
      }
      .main-body {
        flex-direction: column;
      }
      .chat-sidebar {
        display: none;
      }
      .content {
        flex: 1;
        overflow: hidden;
      }
    }
  `],
})
export class LayoutComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  unreadCount = 0;
  chatUnreadCount = 0;
  teamsUnreadCount = 0;
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
  // Device settings
  audioInputDevices: MediaDeviceInfo[] = [];
  videoInputDevices: MediaDeviceInfo[] = [];
  audioOutputDevices: MediaDeviceInfo[] = [];
  selectedAudioInput = '';
  selectedVideoInput = '';
  selectedAudioOutput = '';
  // Context menu
  contextMenu = { show: false, x: 0, y: 0, channel: null as any };
  private subscriptions: Subscription[] = [];
  private ringAudio: HTMLAudioElement | null = null;
  private ringBlobUrl: string | null = null;
  private ringTimeout: any = null;
  private audioUnlocked = false;
  private unlockHandler = () => this.unlockAudio();
  private notificationAudio: HTMLAudioElement | null = null;

  availableLanguages = EU_LANGUAGES;

  // Profile settings
  showProfileSettings = false;
  savingProfile = false;
  profileForm = { display_name: '', email: '', current_password: '', new_password: '', confirm_password: '' };

  // Event reminder
  reminderEvent: any = null;
  reminderCountdown = '';
  private dismissedReminders = new Set<string>();
  private reminderTickInterval: any = null;

  constructor(
    private authService: AuthService,
    private apiService: ApiService,
    private wsService: WebSocketService,
    private router: Router,
    private snackBar: MatSnackBar,
    public i18n: I18nService,
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
    this.loadDevicePreferences();
    this.enumerateDevices();

    this.subscriptions.push(
      this.authService.currentUser$.subscribe((user) => {
        const soundChanged = this.currentUser?.notification_sound_path !== user?.notification_sound_path;
        this.currentUser = user;
        if (soundChanged && this.notificationAudio) {
          this.loadNotificationSound();
        }
      })
    );

    // Poll unread count every 10 seconds
    this.subscriptions.push(
      interval(10000).pipe(
        switchMap(() => this.apiService.getUnreadCount())
      ).subscribe({
        next: (res) => { this.unreadCount = res.unread_count; },
        error: () => {},
      })
    );

    // Initial load
    this.apiService.getUnreadCount().subscribe({
      next: (res) => { this.unreadCount = res.unread_count; },
      error: () => {},
    });

    // Poll pending calendar invitations every 10 seconds
    this.subscriptions.push(
      interval(10000).pipe(
        switchMap(() => this.apiService.getCalendarInvitationCount())
      ).subscribe({
        next: (res) => { this.pendingInvitationsCount = res.count; },
        error: () => {},
      })
    );
    this.apiService.getCalendarInvitationCount().subscribe({
      next: (res) => { this.pendingInvitationsCount = res.count; },
      error: () => {},
    });

    // Event reminder: check every 60 seconds for upcoming events
    this.checkEventReminders();
    this.subscriptions.push(
      interval(60000).pipe(
        switchMap(() => {
          const now = new Date();
          const end = new Date(now.getTime() + 16 * 60 * 1000);
          return this.apiService.getCalendarEvents(now.toISOString(), end.toISOString());
        })
      ).subscribe({
        next: (events) => { this.evaluateReminders(events); },
        error: () => {},
      })
    );

    // Pre-create ringtone audio and unlock on first user gesture
    this.prepareRingtone();
    this.prepareNotificationSound();
    document.addEventListener('click', this.unlockHandler, { once: true });
    document.addEventListener('keydown', this.unlockHandler, { once: true });

    // Load chat channels for sidebar
    this.loadChatChannels();

    // Refresh chat list every 30 seconds
    this.subscriptions.push(
      interval(30000).pipe(
        switchMap(() => this.apiService.getChannels())
      ).subscribe({
        next: (channels) => {
          this.chatChannels = channels;
          this.updateFilteredChannels();
        },
        error: () => {},
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
        // Refresh chat sidebar and play notification sound on new messages
        if (msg.type === 'new_message') {
          const msgChannelId = msg._channelId || msg.message?.channel_id;
          const isActiveChannel = msgChannelId && msgChannelId === this.activeChannelId;
          this.loadChatChannels(isActiveChannel ? msgChannelId : undefined);
          if (isActiveChannel) {
            // User is viewing this channel – mark its feed events as read
            // so the feed badge does not increment for visible messages.
            this.apiService.markFeedRead({ channel_id: msgChannelId }).subscribe({
              next: () => {
                this.apiService.getUnreadCount().subscribe({
                  next: (res) => { this.unreadCount = res.unread_count; },
                  error: () => {},
                });
              },
              error: () => {},
            });
          }
          // Play notification sound only if not from ourselves AND not the currently open chat
          if (msg.message?.sender_id !== this.currentUser?.id && !isActiveChannel) {
            this.playNotificationSound();
          }
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

  loadChatChannels(clearChannelId?: string): void {
    this.apiService.getChannels().subscribe({
      next: (channels) => {
        this.chatChannels = channels;
        // If the user is viewing a channel right now, zero its unread count
        // so it doesn't flash a badge for messages the user already sees.
        if (clearChannelId) {
          const ch = this.chatChannels.find((c) => c.id === clearChannelId);
          if (ch) {
            ch.unread_count = 0;
          }
        }
        this.updateFilteredChannels();
      },
      error: () => {},
    });
  }

  private updateFilteredChannels(): void {
    if (this.sidebarMode === 'teams') {
      this.filteredChannels = this.chatChannels.filter((ch) => ch.team_id || ch.channel_type === 'team');
    } else {
      this.filteredChannels = this.chatChannels.filter((ch) => !ch.team_id && ch.channel_type !== 'team');
    }
    // Compute unread counts for nav badges
    this.chatUnreadCount = this.chatChannels
      .filter((ch) => !ch.team_id && ch.channel_type !== 'team')
      .reduce((sum, ch) => sum + (ch.unread_count || 0), 0);
    this.teamsUnreadCount = this.chatChannels
      .filter((ch) => ch.team_id || ch.channel_type === 'team')
      .reduce((sum, ch) => sum + (ch.unread_count || 0), 0);
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
    // Mark all feed events for this channel as read so they disappear from the feed
    this.apiService.markFeedRead({ channel_id: channelId }).subscribe({
      next: () => {
        // Refresh the global unread count badge
        this.apiService.getUnreadCount().subscribe({
          next: (res) => { this.unreadCount = res.unread_count; },
          error: () => {},
        });
      },
      error: () => {},
    });
  }

  openNewMeeting(): void {
    const name = prompt(this.i18n.t('meeting.name_prompt'));
    if (!name) return;
    const dateStr = prompt(this.i18n.t('meeting.date_prompt'));
    if (!dateStr) return;
    const scheduledAt = new Date(dateStr);
    if (isNaN(scheduledAt.getTime())) {
      alert(this.i18n.t('meeting.invalid_date'));
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

  renameChat(): void {
    if (!this.contextMenu.channel) return;
    const ch = this.contextMenu.channel;
    this.contextMenu.show = false;
    const newName = prompt(this.i18n.t('chat.rename_prompt'), ch.name);
    if (newName && newName.trim() && newName.trim() !== ch.name) {
      this.apiService.updateChannel(ch.id, { name: newName.trim() }).subscribe({
        next: (updated) => {
          ch.name = updated.name;
        },
        error: () => {},
      });
    }
  }

  deleteChat(): void {
    if (!this.contextMenu.channel) return;
    const ch = this.contextMenu.channel;
    this.contextMenu.show = false;
    if (confirm(`${this.i18n.t('chat.confirm_delete_chat')} "${ch.name}"?`)) {
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

  // ---------- Event Reminders ----------

  private checkEventReminders(): void {
    const now = new Date();
    const end = new Date(now.getTime() + 16 * 60 * 1000);
    this.apiService.getCalendarEvents(now.toISOString(), end.toISOString()).subscribe({
      next: (events) => this.evaluateReminders(events),
      error: () => {},
    });
  }

  private evaluateReminders(events: any[]): void {
    const now = Date.now();
    const fifteenMin = 15 * 60 * 1000;

    // Find the nearest event starting within 0–15 minutes that hasn't been dismissed
    let nearest: any = null;
    let nearestDiff = Infinity;

    for (const ev of events) {
      if (ev.all_day) continue;
      if (this.dismissedReminders.has(ev.id)) continue;
      const start = new Date(ev.start_time).getTime();
      const diff = start - now;
      if (diff > 0 && diff <= fifteenMin && diff < nearestDiff) {
        nearest = ev;
        nearestDiff = diff;
      }
    }

    if (nearest && (!this.reminderEvent || this.reminderEvent.id !== nearest.id)) {
      this.reminderEvent = nearest;
      this.startReminderTick();
    } else if (!nearest && this.reminderEvent) {
      // Event has passed or was dismissed
      const start = new Date(this.reminderEvent.start_time).getTime();
      if (start <= now) {
        this.reminderEvent = null;
        this.stopReminderTick();
      }
    }
  }

  private startReminderTick(): void {
    this.stopReminderTick();
    this.updateReminderCountdown();
    this.reminderTickInterval = setInterval(() => this.updateReminderCountdown(), 1000);
  }

  private stopReminderTick(): void {
    if (this.reminderTickInterval) {
      clearInterval(this.reminderTickInterval);
      this.reminderTickInterval = null;
    }
  }

  private updateReminderCountdown(): void {
    if (!this.reminderEvent) {
      this.stopReminderTick();
      return;
    }
    const now = Date.now();
    const start = new Date(this.reminderEvent.start_time).getTime();
    const diff = start - now;
    if (diff <= 0) {
      this.reminderCountdown = this.i18n.t('reminder.now');
      this.stopReminderTick();
      // Auto-dismiss after 60 seconds past start
      setTimeout(() => {
        if (this.reminderEvent) {
          this.dismissedReminders.add(this.reminderEvent.id);
          this.reminderEvent = null;
        }
      }, 60000);
      return;
    }
    const totalSeconds = Math.floor(diff / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    this.reminderCountdown = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  formatReminderTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  joinRemindedEvent(): void {
    if (!this.reminderEvent?.channel_id) return;
    const channelId = this.reminderEvent.channel_id;
    this.dismissedReminders.add(this.reminderEvent.id);
    this.reminderEvent = null;
    this.stopReminderTick();
    this.router.navigate(['/video', channelId]);
  }

  dismissReminder(): void {
    if (this.reminderEvent) {
      this.dismissedReminders.add(this.reminderEvent.id);
      this.reminderEvent = null;
      this.stopReminderTick();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.stopRinging();
    this.stopReminderTick();
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

  /** Pre-create the notification sound Audio element. */
  private prepareNotificationSound(): void {
    this.loadNotificationSound();
  }

  /** Load (or reload) the notification sound based on user preference. */
  private loadNotificationSound(): void {
    try {
      const customUrl = this.apiService.getNotificationSoundUrl(
        this.currentUser?.notification_sound_path ?? null
      );
      this.notificationAudio = new Audio(customUrl || 'assets/sounds/star-trek-communicator.mp3');
    } catch {
      // Audio not available
    }
  }

  /** Play the notification sound for new messages. */
  private playNotificationSound(): void {
    if (!this.notificationAudio) return;
    this.notificationAudio.currentTime = 0;
    this.notificationAudio.play().catch(() => {});
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
    if (this.audioUnlocked) return;
    if (this.ringAudio) {
      this.ringAudio.volume = 0;
      this.ringAudio.play().then(() => {
        this.ringAudio!.pause();
        this.ringAudio!.currentTime = 0;
        this.ringAudio!.volume = 1;
      }).catch(() => {});
    }
    if (this.notificationAudio) {
      this.notificationAudio.volume = 0;
      this.notificationAudio.play().then(() => {
        this.notificationAudio!.pause();
        this.notificationAudio!.currentTime = 0;
        this.notificationAudio!.volume = 1;
      }).catch(() => {});
    }
    this.audioUnlocked = true;
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

  enumerateDevices(): void {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      this.audioInputDevices = devices.filter((d) => d.kind === 'audioinput');
      this.videoInputDevices = devices.filter((d) => d.kind === 'videoinput');
      this.audioOutputDevices = devices.filter((d) => d.kind === 'audiooutput');
    }).catch(() => {});
  }

  private loadDevicePreferences(): void {
    this.selectedAudioInput = localStorage.getItem('agora_audio_input') || '';
    this.selectedVideoInput = localStorage.getItem('agora_video_input') || '';
    this.selectedAudioOutput = localStorage.getItem('agora_audio_output') || '';
  }

  onAudioInputChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedAudioInput = value;
    localStorage.setItem('agora_audio_input', value);
  }

  onVideoInputChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedVideoInput = value;
    localStorage.setItem('agora_video_input', value);
  }

  onAudioOutputChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedAudioOutput = value;
    localStorage.setItem('agora_audio_output', value);
  }

  setLanguage(code: string): void {
    this.i18n.setLanguage(code);
    // Persist to backend
    this.apiService.updateProfile({ language: code }).subscribe({
      next: () => {
        this.authService.updateLocalUser({ language: code } as any);
      },
      error: () => {},
    });
  }

  getAvatarUrl(avatarPath: string | null | undefined): string | null {
    if (!avatarPath) return null;
    return this.apiService.getAvatarUrl(avatarPath);
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.apiService.uploadAvatar(file).subscribe({
      next: (user) => {
        this.authService.updateLocalUser({ avatar_path: user.avatar_path });
        if (this.currentUser) {
          this.currentUser.avatar_path = user.avatar_path;
        }
        this.snackBar.open(this.i18n.t('profile.avatar_uploaded'), this.i18n.t('common.ok'), { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
    input.value = '';
  }

  onNotificationSoundSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.apiService.uploadNotificationSound(file).subscribe({
      next: (user) => {
        this.authService.updateLocalUser({ notification_sound_path: user.notification_sound_path });
        if (this.currentUser) {
          this.currentUser.notification_sound_path = user.notification_sound_path;
        }
        this.loadNotificationSound();
        this.snackBar.open(this.i18n.t('profile.notification_sound_uploaded'), this.i18n.t('common.ok'), { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
    input.value = '';
  }

  resetNotificationSound(): void {
    this.apiService.deleteNotificationSound().subscribe({
      next: (user) => {
        this.authService.updateLocalUser({ notification_sound_path: null });
        if (this.currentUser) {
          this.currentUser.notification_sound_path = null;
        }
        this.loadNotificationSound();
        this.snackBar.open(this.i18n.t('profile.notification_sound_reset'), this.i18n.t('common.ok'), { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  testNotificationSound(): void {
    this.playNotificationSound();
  }

  openProfileSettings(): void {
    this.showProfileSettings = true;
    this.profileForm = {
      display_name: this.currentUser?.display_name || '',
      email: this.currentUser?.email || '',
      current_password: '',
      new_password: '',
      confirm_password: '',
    };
  }

  saveProfile(): void {
    const updates: any = {};
    if (this.profileForm.display_name && this.profileForm.display_name !== this.currentUser?.display_name) {
      updates.display_name = this.profileForm.display_name;
    }
    if (this.profileForm.email && this.profileForm.email !== this.currentUser?.email) {
      updates.email = this.profileForm.email;
    }
    if (Object.keys(updates).length === 0) return;
    this.savingProfile = true;
    this.apiService.updateProfile(updates).subscribe({
      next: (user) => {
        this.authService.updateLocalUser(updates);
        this.snackBar.open(this.i18n.t('profile.saved'), this.i18n.t('common.ok'), { duration: 3000 });
        this.savingProfile = false;
      },
      error: (err) => {
        this.savingProfile = false;
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  changePassword(): void {
    if (!this.profileForm.current_password || !this.profileForm.new_password) {
      this.snackBar.open(this.i18n.t('profile.fill_password_fields'), this.i18n.t('common.ok'), { duration: 3000 });
      return;
    }
    if (this.profileForm.new_password !== this.profileForm.confirm_password) {
      this.snackBar.open(this.i18n.t('profile.passwords_mismatch'), this.i18n.t('common.ok'), { duration: 3000 });
      return;
    }
    this.savingProfile = true;
    this.apiService.updateProfile({
      password: this.profileForm.new_password,
      current_password: this.profileForm.current_password,
    }).subscribe({
      next: () => {
        this.snackBar.open(this.i18n.t('profile.password_changed'), this.i18n.t('common.ok'), { duration: 3000 });
        this.profileForm.current_password = '';
        this.profileForm.new_password = '';
        this.profileForm.confirm_password = '';
        this.savingProfile = false;
      },
      error: (err) => {
        this.savingProfile = false;
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
