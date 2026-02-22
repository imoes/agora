import { Component, OnInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription, Subject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { take } from 'rxjs/operators';
import { WebRTCService, Participant } from '@services/webrtc.service';
import { WebSocketService } from '@services/websocket.service';
import { ApiService } from '@services/api.service';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatSnackBarModule],
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
          <div class="video-tile small" [class.audio-tile]="!videoEnabled">
            <video #localVideo autoplay muted playsinline [hidden]="!videoEnabled"></video>
            <div *ngIf="!videoEnabled" class="audio-avatar small">
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
        <div class="grid-wrapper">
          <!-- Active speaker sidebar -->
          <div class="speaker-sidebar" *ngIf="activeSpeakerId && allTiles.length > 1">
            <ng-container *ngIf="activeSpeakerId === currentUserId">
              <div class="video-tile speaking local" [class.audio-tile]="!videoEnabled">
                <video #localVideo autoplay muted playsinline [hidden]="!videoEnabled"></video>
                <div *ngIf="!videoEnabled" class="audio-avatar">
                  <mat-icon>{{ audioEnabled ? 'mic' : 'mic_off' }}</mat-icon>
                  <span>Du</span>
                </div>
                <span class="hand-raised-badge" *ngIf="handRaised">&#x1F91A;</span>
                <div class="video-label">Du
                  <mat-icon *ngIf="!audioEnabled" class="mute-icon">mic_off</mat-icon>
                </div>
              </div>
            </ng-container>
            <ng-container *ngIf="activeSpeakerId !== currentUserId">
              <div *ngFor="let p of participantList" class="video-tile speaking"
                   [class.audio-tile]="!p.videoEnabled"
                   [style.display]="p.userId === activeSpeakerId ? 'block' : 'none'">
                <video [id]="'speaker-video-' + p.userId" autoplay playsinline></video>
                <div *ngIf="!p.videoEnabled" class="audio-avatar">
                  <mat-icon>{{ p.audioEnabled ? 'person' : 'mic_off' }}</mat-icon>
                  <span>{{ p.displayName }}</span>
                </div>
                <span class="hand-raised-badge" *ngIf="p.handRaised">&#x1F91A;</span>
                <div class="video-label">{{ p.displayName }}
                  <mat-icon *ngIf="!p.audioEnabled" class="mute-icon">mic_off</mat-icon>
                </div>
              </div>
            </ng-container>
          </div>

          <!-- Main grid area -->
          <div class="video-grid" [class.single]="pagedTiles.length <= 1"
               [class.has-speaker]="activeSpeakerId && allTiles.length > 1">
            <!-- Paged tiles -->
            <ng-container *ngFor="let tile of pagedTiles">
              <!-- Local Video -->
              <div *ngIf="tile.type === 'local'" class="video-tile local"
                   [class.audio-tile]="!videoEnabled"
                   [class.speaking]="activeSpeakerId === currentUserId">
                <video #localVideo autoplay muted playsinline [hidden]="!videoEnabled"></video>
                <div *ngIf="!videoEnabled" class="audio-avatar">
                  <mat-icon>{{ audioEnabled ? 'mic' : 'mic_off' }}</mat-icon>
                  <span>Du</span>
                </div>
                <span class="hand-raised-badge" *ngIf="handRaised">&#x1F91A;</span>
                <div class="video-label">Du
                  <mat-icon *ngIf="!audioEnabled" class="mute-icon">mic_off</mat-icon>
                </div>
              </div>

              <!-- Remote Videos -->
              <div *ngIf="tile.type === 'remote'" class="video-tile"
                   [class.audio-tile]="!tile.participant!.videoEnabled"
                   [class.speaking]="activeSpeakerId === tile.participant!.userId">
                <video [id]="'video-' + tile.participant!.userId" autoplay playsinline></video>
                <div *ngIf="!tile.participant!.videoEnabled" class="audio-avatar">
                  <mat-icon>{{ tile.participant!.audioEnabled ? 'person' : 'mic_off' }}</mat-icon>
                  <span>{{ tile.participant!.displayName }}</span>
                </div>
                <span class="hand-raised-badge" *ngIf="tile.participant!.handRaised">&#x1F91A;</span>
                <div class="video-label">{{ tile.participant!.displayName }}
                  <mat-icon *ngIf="!tile.participant!.audioEnabled" class="mute-icon">mic_off</mat-icon>
                </div>
              </div>
            </ng-container>
          </div>
        </div>

        <!-- Pagination arrows -->
        <div class="pagination-bar" *ngIf="totalPages > 1">
          <button mat-icon-button (click)="prevPage()" [disabled]="currentPage === 0">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="page-indicator">{{ currentPage + 1 }} / {{ totalPages }}</span>
          <button mat-icon-button (click)="nextPage()" [disabled]="currentPage >= totalPages - 1">
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
      </ng-template>

      <!-- Chat Sidebar -->
      <div class="chat-sidebar" *ngIf="showChatPanel">
        <div class="chat-sidebar-header">
          <mat-icon>chat</mat-icon>
          <span>Chat</span>
          <button mat-icon-button (click)="showChatPanel = false">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        <div class="chat-sidebar-messages" #chatMessagesContainer>
          <div *ngFor="let msg of chatMessages" class="chat-sidebar-msg"
               [class.own]="msg.sender_id === currentUserId">
            <div class="chat-sidebar-msg-header" *ngIf="msg.sender_id !== currentUserId">
              <span class="chat-sidebar-sender">{{ msg.sender_name }}</span>
              <span class="chat-sidebar-time">{{ formatChatTime(msg.created_at) }}</span>
            </div>
            <div class="chat-sidebar-msg-header" *ngIf="msg.sender_id === currentUserId">
              <span class="chat-sidebar-time">{{ formatChatTime(msg.created_at) }}</span>
            </div>
            <div class="chat-sidebar-bubble" [class.own]="msg.sender_id === currentUserId">
              {{ msg.content }}
            </div>
          </div>
          <div *ngIf="chatMessages.length === 0" class="chat-sidebar-empty">
            Noch keine Nachrichten
          </div>
        </div>
        <div class="chat-sidebar-input">
          <input type="text" [(ngModel)]="chatText"
                 (keydown.enter)="sendChatMessage()"
                 placeholder="Nachricht schreiben...">
          <button mat-icon-button (click)="sendChatMessage()" [disabled]="!chatText.trim()">
            <mat-icon>send</mat-icon>
          </button>
        </div>
      </div>

      <!-- Invite Panel -->
      <div class="invite-panel" *ngIf="showInvitePanel">
        <div class="invite-panel-header">
          <span>Benutzer anrufen</span>
          <button mat-icon-button (click)="showInvitePanel = false">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        <div class="invite-search">
          <mat-icon>search</mat-icon>
          <input type="text" [(ngModel)]="userSearchQuery"
                 (ngModelChange)="onSearchQueryChange($event)"
                 placeholder="Benutzer suchen...">
        </div>
        <div class="invite-panel-list">
          <!-- Channel members (when no search) -->
          <div *ngIf="!userSearchQuery">
            <div *ngFor="let m of callableMembers" class="invite-member-item">
              <div class="invite-avatar-wrapper">
                <div class="invite-member-avatar">{{ m.display_name?.charAt(0)?.toUpperCase() }}</div>
                <span class="invite-status-dot" [class]="m.status || 'offline'"></span>
              </div>
              <div class="invite-member-info">
                <span class="invite-member-name">{{ m.display_name }}</span>
                <span class="invite-member-username">{{'@' + m.username}}</span>
              </div>
              <button mat-icon-button *ngIf="!invitedUserIds.has(m.id)"
                      [matTooltip]="m.status === 'offline' ? 'Offline' : 'Anrufen'"
                      (click)="inviteToCall(m)"
                      [disabled]="m.status === 'offline'"
                      [class.call-online]="m.status && m.status !== 'offline'">
                <mat-icon>call</mat-icon>
              </button>
              <button mat-icon-button *ngIf="invitedUserIds.has(m.id)"
                      matTooltip="Anruf abbrechen"
                      (click)="cancelInvite(m)"
                      class="call-cancel">
                <mat-icon>call_end</mat-icon>
              </button>
            </div>
            <p *ngIf="callableMembers.length === 0" class="no-members">Keine weiteren Mitglieder</p>
          </div>
          <!-- Search results -->
          <div *ngIf="userSearchQuery">
            <div *ngIf="searchLoading" class="no-members">Suche...</div>
            <div *ngFor="let u of searchResults" class="invite-member-item">
              <div class="invite-avatar-wrapper">
                <div class="invite-member-avatar">{{ u.display_name?.charAt(0)?.toUpperCase() }}</div>
                <span class="invite-status-dot" [class]="u.status || 'offline'"></span>
              </div>
              <div class="invite-member-info">
                <span class="invite-member-name">{{ u.display_name }}</span>
                <span class="invite-member-username">{{'@' + u.username}}</span>
              </div>
              <button mat-icon-button *ngIf="!invitedUserIds.has(u.id)"
                      [matTooltip]="u.status === 'offline' ? 'Offline' : 'Anrufen'"
                      (click)="inviteToCall(u)"
                      [disabled]="u.status === 'offline'"
                      [class.call-online]="u.status && u.status !== 'offline'">
                <mat-icon>call</mat-icon>
              </button>
              <button mat-icon-button *ngIf="invitedUserIds.has(u.id)"
                      matTooltip="Anruf abbrechen"
                      (click)="cancelInvite(u)"
                      class="call-cancel">
                <mat-icon>call_end</mat-icon>
              </button>
            </div>
            <p *ngIf="!searchLoading && searchResults.length === 0 && userSearchQuery.length >= 2" class="no-members">Keine Benutzer gefunden</p>
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
                (click)="toggleVideo()" matTooltip="Kamera">
          <mat-icon>{{ videoEnabled ? 'videocam' : 'videocam_off' }}</mat-icon>
        </button>
        <button mat-fab
                [color]="handRaised ? 'accent' : undefined"
                (click)="toggleHandRaise()"
                [matTooltip]="handRaised ? 'Hand senken' : 'Hand heben'">
          <mat-icon>{{ handRaised ? 'back_hand' : 'back_hand' }}</mat-icon>
        </button>
        <button mat-fab
                [color]="isScreenSharing ? 'accent' : undefined"
                (click)="toggleScreenShare()"
                [matTooltip]="isScreenSharing ? 'Freigabe beenden' : 'Bildschirm freigeben'">
          <mat-icon>{{ isScreenSharing ? 'stop_screen_share' : 'screen_share' }}</mat-icon>
        </button>
        <button mat-fab (click)="toggleChatPanel()" matTooltip="Chat"
                [color]="showChatPanel ? 'accent' : undefined"
                class="chat-fab-btn">
          <mat-icon>chat</mat-icon>
          <span class="chat-badge" *ngIf="unreadChatCount > 0">{{ unreadChatCount > 99 ? '99+' : unreadChatCount }}</span>
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
      min-height: 0;
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
      min-height: 0;
      overflow: auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 8px;
      padding: 16px;
      align-content: center;
    }
    .video-grid.single {
      grid-template-columns: 1fr;
      justify-items: center;
    }
    .video-grid.single .video-tile {
      max-width: 960px;
      width: 100%;
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
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
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
    .invite-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid #444;
    }
    .invite-search mat-icon {
      color: #888;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .invite-search input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: white;
      font-size: 13px;
      font-family: inherit;
    }
    .invite-search input::placeholder { color: #888; }
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
    .invite-avatar-wrapper {
      position: relative;
      flex-shrink: 0;
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
    }
    .invite-status-dot {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid #333;
    }
    .invite-status-dot.online { background: var(--online, #00c851); }
    .invite-status-dot.busy { background: #c4314b; }
    .invite-status-dot.away { background: #fcba12; }
    .invite-status-dot.dnd { background: #c4314b; }
    .invite-status-dot.offline { background: #8a8886; }
    .invite-member-info { flex: 1; }
    .invite-member-name { color: white; font-size: 13px; font-weight: 500; display: block; }
    .invite-member-username { color: #aaa; font-size: 11px; }
    .invite-member-item button { color: #666; }
    .invite-member-item button.call-online { color: #76ff03; }
    .invite-member-item button.call-cancel { color: #ff5252; }
    .invite-member-item button[disabled] { color: #555; }
    .no-members { color: #888; text-align: center; padding: 16px; font-size: 13px; }
    /* Chat sidebar */
    .chat-sidebar {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 80px;
      width: 340px;
      background: #2d2d2d;
      display: flex;
      flex-direction: column;
      z-index: 10;
      border-left: 1px solid #444;
    }
    @media (max-width: 600px) {
      .chat-sidebar {
        width: 100%;
      }
    }
    .chat-sidebar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: #3a3a3a;
      color: white;
      font-weight: 500;
      font-size: 14px;
      flex-shrink: 0;
    }
    .chat-sidebar-header mat-icon:first-child {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .chat-sidebar-header span { flex: 1; }
    .chat-sidebar-header button { color: #aaa; }
    .chat-sidebar-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-sidebar-msg {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    .chat-sidebar-msg.own {
      align-items: flex-end;
    }
    .chat-sidebar-msg-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 2px;
    }
    .chat-sidebar-sender {
      color: #aaa;
      font-size: 11px;
      font-weight: 500;
    }
    .chat-sidebar-time {
      color: #666;
      font-size: 10px;
    }
    .chat-sidebar-bubble {
      background: #3d3d3d;
      color: white;
      padding: 8px 12px;
      border-radius: 12px 12px 12px 4px;
      font-size: 13px;
      max-width: 85%;
      word-break: break-word;
      line-height: 1.4;
    }
    .chat-sidebar-bubble.own {
      background: #6264a7;
      border-radius: 12px 12px 4px 12px;
    }
    .chat-sidebar-empty {
      color: #666;
      text-align: center;
      padding: 32px 16px;
      font-size: 13px;
    }
    .chat-sidebar-input {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 12px;
      border-top: 1px solid #444;
      background: #333;
      flex-shrink: 0;
    }
    .chat-sidebar-input input {
      flex: 1;
      background: #3d3d3d;
      border: 1px solid #555;
      border-radius: 20px;
      padding: 8px 14px;
      color: white;
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }
    .chat-sidebar-input input::placeholder { color: #888; }
    .chat-sidebar-input input:focus { border-color: #6264a7; }
    .chat-sidebar-input button { color: #6264a7; }
    .chat-sidebar-input button[disabled] { color: #555; }
    /* Chat badge */
    .chat-fab-btn {
      position: relative;
    }
    .chat-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      background: #c4314b;
      color: white;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      line-height: 1;
    }
    /* Grid wrapper with speaker sidebar */
    .grid-wrapper {
      flex: 1;
      min-height: 0;
      display: flex;
      overflow: hidden;
    }
    .speaker-sidebar {
      width: 280px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px;
      border-right: 2px solid #6264a7;
      background: #222;
    }
    .speaker-sidebar .video-tile {
      width: 100%;
      max-width: 260px;
    }
    /* Speaking highlight */
    .video-tile.speaking {
      box-shadow: 0 0 0 3px #6264a7, 0 0 16px rgba(98, 100, 167, 0.5);
    }
    /* Hand raised badge */
    .hand-raised-badge {
      position: absolute;
      top: 8px;
      right: 8px;
      font-size: 28px;
      z-index: 2;
      animation: hand-wave 1s ease-in-out 3;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
    }
    @keyframes hand-wave {
      0%, 100% { transform: rotate(0deg); }
      25% { transform: rotate(20deg); }
      75% { transform: rotate(-15deg); }
    }
    /* Pagination */
    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 6px 0;
      background: #292929;
      flex-shrink: 0;
    }
    .pagination-bar button {
      color: white;
    }
    .pagination-bar button[disabled] {
      color: #555;
    }
    .page-indicator {
      color: #ccc;
      font-size: 13px;
      min-width: 50px;
      text-align: center;
    }
    .video-grid.has-speaker {
      flex: 1;
    }
    .video-controls {
      display: flex;
      justify-content: center;
      gap: 16px;
      padding: 20px;
      background: #292929;
      flex-shrink: 0;
    }
    @media (max-width: 600px) {
      .video-grid {
        grid-template-columns: 1fr;
        padding: 8px;
        gap: 6px;
      }
      .video-controls {
        gap: 8px;
        padding: 12px 8px;
      }
      .speaker-sidebar {
        width: 100px;
      }
      .speaker-sidebar .video-tile {
        max-width: 90px;
      }
      .presentation-sidebar {
        width: 120px;
      }
      .chat-sidebar {
        width: 100%;
      }
    }
  `],
})
export class VideoRoomComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('screenVideo') screenVideo!: ElementRef<HTMLVideoElement>;

  @ViewChild('chatMessagesContainer') chatMessagesContainer?: ElementRef<HTMLElement>;

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

  // Hand raise
  handRaised = false;

  // Pagination
  readonly TILES_PER_PAGE = 9;
  currentPage = 0;
  allTiles: { type: 'local' | 'remote'; participant?: Participant }[] = [];
  pagedTiles: { type: 'local' | 'remote'; participant?: Participant }[] = [];
  totalPages = 1;

  // Active speaker
  activeSpeakerId: string | null = null;

  // Track whether remote participants have ever joined (to auto-close when all leave)
  private hadRemoteParticipants = false;

  // Chat sidebar
  showChatPanel = false;
  chatMessages: any[] = [];
  chatText = '';
  unreadChatCount = 0;
  private chatWsSubscription?: Subscription;
  channelMembers: any[] = [];
  callableMembers: any[] = [];
  invitedUserIds = new Set<string>();
  userSearchQuery = '';
  searchResults: any[] = [];
  searchLoading = false;
  private searchSubject = new Subject<string>();
  currentUserId = '';
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

    // User search with debounce
    this.subscriptions.push(
      this.searchSubject.pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (query.length < 2) {
            this.searchLoading = false;
            return of([]);
          }
          this.searchLoading = true;
          return this.apiService.searchUsers(query);
        }),
      ).subscribe((users) => {
        const inCallIds = new Set(this.participantList.map((p) => p.userId));
        inCallIds.add(this.currentUserId);
        this.searchResults = users.filter((u: any) => !inCallIds.has(u.id));
        this.searchLoading = false;
      })
    );

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

        if (this.participantList.length > 0) {
          this.hadRemoteParticipants = true;
        } else if (this.hadRemoteParticipants) {
          // All remote participants have left – auto-close the call
          this.endCall();
          return;
        }

        this.updateCallableMembers();
        this.rebuildTiles();
        this.pendingStreamAttach = true;
        this.cdr.detectChanges();
      })
    );

    // Subscribe to hand raises
    this.subscriptions.push(
      this.webrtcService.handRaised$.subscribe((raised) => {
        this.handRaised = raised.has(this.currentUserId);
      })
    );

    // Subscribe to active speaker
    this.subscriptions.push(
      this.webrtcService.activeSpeaker$.subscribe((speakerId) => {
        if (speakerId !== this.activeSpeakerId) {
          this.activeSpeakerId = speakerId;
          this.pendingStreamAttach = true;
          this.cdr.detectChanges();
        }
      })
    );

    // Start speaker detection
    this.webrtcService.startSpeakerDetection();

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
      // Speaker sidebar video
      const speakerEl = document.getElementById('speaker-video-' + p.userId) as HTMLVideoElement;
      if (speakerEl && p.stream && speakerEl.srcObject !== p.stream) {
        speakerEl.srcObject = p.stream;
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
    this.chatWsSubscription?.unsubscribe();
    this.webrtcService.stopSpeakerDetection();
    this.webrtcService.endCall();
    this.apiService.leaveVideoRoom(this.channelId).subscribe({ error: () => {} });
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

  onSearchQueryChange(query: string): void {
    if (!query) {
      this.searchResults = [];
      this.searchLoading = false;
      return;
    }
    this.searchSubject.next(query);
  }

  toggleInvitePanel(): void {
    this.showInvitePanel = !this.showInvitePanel;
    if (this.showInvitePanel) {
      this.userSearchQuery = '';
      this.searchResults = [];
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
    // Auto-reset after 30s (call timeout)
    setTimeout(() => this.invitedUserIds.delete(user.id), 30000);
  }

  cancelInvite(user: any): void {
    this.wsService.send(this.channelId, {
      type: 'video_call_cancel',
      target_user_id: user.id,
    });
    this.invitedUserIds.delete(user.id);
    this.snackBar.open('Anruf abgebrochen', 'OK', { duration: 2000 });
  }

  // --- Chat sidebar ---

  toggleChatPanel(): void {
    this.showChatPanel = !this.showChatPanel;
    if (this.showChatPanel) {
      this.unreadChatCount = 0;
      this.showInvitePanel = false;
      if (!this.chatWsSubscription) {
        this.connectChatWs();
      }
      if (this.chatMessages.length === 0) {
        this.loadChatMessages();
      }
      this.scrollChatToBottom();
    }
  }

  private loadChatMessages(): void {
    this.apiService.getMessages(this.channelId, 50).subscribe((msgs) => {
      this.chatMessages = msgs.reverse();
      this.scrollChatToBottom();
    });
  }

  private connectChatWs(): void {
    // Subscribe to global WS messages (piggyback on WebRTC's existing connection)
    this.chatWsSubscription = this.wsService.globalMessages$.subscribe((msg) => {
      if (msg.type === 'new_message' && msg.message) {
        this.chatMessages.push(msg.message);
        if (this.showChatPanel) {
          this.scrollChatToBottom();
        } else {
          this.unreadChatCount++;
        }
      }
    });
  }

  sendChatMessage(): void {
    const text = this.chatText.trim();
    if (!text) return;
    this.chatText = '';
    this.wsService.send(this.channelId, {
      type: 'message',
      content: text,
      message_type: 'text',
    });
  }

  private scrollChatToBottom(): void {
    setTimeout(() => {
      const el = this.chatMessagesContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 50);
  }

  formatChatTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // --- Hand raise ---

  toggleHandRaise(): void {
    this.handRaised = !this.handRaised;
    this.webrtcService.toggleHandRaise(this.handRaised);
  }

  // --- Pagination ---

  private rebuildTiles(): void {
    this.allTiles = [
      { type: 'local' as const },
      ...this.participantList.map(p => ({ type: 'remote' as const, participant: p })),
    ];
    this.totalPages = Math.max(1, Math.ceil(this.allTiles.length / this.TILES_PER_PAGE));
    if (this.currentPage >= this.totalPages) {
      this.currentPage = this.totalPages - 1;
    }
    this.updatePagedTiles();
  }

  private updatePagedTiles(): void {
    const start = this.currentPage * this.TILES_PER_PAGE;
    this.pagedTiles = this.allTiles.slice(start, start + this.TILES_PER_PAGE);
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages - 1) {
      this.currentPage++;
      this.updatePagedTiles();
      this.pendingStreamAttach = true;
      this.cdr.detectChanges();
    }
  }

  prevPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.updatePagedTiles();
      this.pendingStreamAttach = true;
      this.cdr.detectChanges();
    }
  }

  // --- End call ---

  endCall(): void {
    this.webrtcService.endCall();
    this.apiService.leaveVideoRoom(this.channelId).subscribe({ error: () => {} });
    this.router.navigate(['/chat', this.channelId]);
  }
}
