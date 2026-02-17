import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ApiService } from '@services/api.service';
import { WebSocketService } from '@services/websocket.service';
import { AuthService, User } from '@core/services/auth.service';
import { InviteDialogComponent } from '../invite-dialog/invite-dialog.component';
import { I18nService } from '@services/i18n.service';

@Component({
  selector: 'app-chat-room',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatMenuModule, MatTooltipModule,
    MatProgressSpinnerModule, MatDialogModule, MatSnackBarModule,
  ],
  template: `
    <!-- Fullscreen media overlay -->
    <div class="media-overlay" *ngIf="fullscreenMedia" (click)="closeMediaFullscreen()">
      <button mat-icon-button class="overlay-close">
        <mat-icon>close</mat-icon>
      </button>
      <img *ngIf="fullscreenMedia.type === 'image'" [src]="fullscreenMedia.url"
           [alt]="fullscreenMedia.name" (click)="$event.stopPropagation()">
      <video *ngIf="fullscreenMedia.type === 'video'" [src]="fullscreenMedia.url"
             controls autoplay (click)="$event.stopPropagation()"></video>
      <div class="overlay-filename">{{ fullscreenMedia.name }}</div>
    </div>

    <div class="chat-room">
      <!-- Header -->
      <div class="chat-room-header">
        <button mat-icon-button (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="channel-info">
          <h3 *ngIf="!editingName" (click)="startEditName()" class="channel-name-editable"
              [matTooltip]="i18n.t('chat.rename_tooltip')">{{ channel?.name }}</h3>
          <div *ngIf="editingName" class="edit-name-row">
            <input class="edit-name-input" [(ngModel)]="editNameValue"
                   (keydown.enter)="saveChannelName()"
                   (keydown.escape)="cancelEditName()"
                   #editNameInput>
            <button mat-icon-button (click)="saveChannelName()" class="edit-name-btn">
              <mat-icon>check</mat-icon>
            </button>
            <button mat-icon-button (click)="cancelEditName()" class="edit-name-btn">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <span class="member-count" matTooltip="{{ memberNames }}">
            {{ memberNamesShort }} ({{ channel?.member_count }})
          </span>
        </div>
        <div class="header-actions">
          <button mat-icon-button [matTooltip]="i18n.t('chat.add_member')" (click)="openInviteDialog()">
            <mat-icon>group_add</mat-icon>
          </button>
          <button mat-icon-button [matTooltip]="i18n.t('chat.audio_call')" (click)="startAudioCall()">
            <mat-icon>call</mat-icon>
          </button>
          <button mat-icon-button [matTooltip]="i18n.t('chat.video_call')" (click)="startVideoCall()">
            <mat-icon>videocam</mat-icon>
          </button>
          <button mat-icon-button [matTooltip]="i18n.t('chat.files')" (click)="showFiles = !showFiles">
            <mat-icon>attach_file</mat-icon>
          </button>
          <button mat-icon-button
                  [matTooltip]="channel?.is_subscribed ? i18n.t('chat.unsubscribe') : i18n.t('chat.subscribe')"
                  (click)="toggleSubscription()"
                  *ngIf="channel?.channel_type === 'team'">
            <mat-icon>{{ channel?.is_subscribed ? 'notifications_active' : 'notifications_off' }}</mat-icon>
          </button>
          <button mat-icon-button [matTooltip]="i18n.t('chat.leave')" (click)="leaveChannel()"
                  *ngIf="channel?.channel_type === 'group' || channel?.channel_type === 'meeting'">
            <mat-icon>logout</mat-icon>
          </button>
        </div>
      </div>

      <!-- Files sidebar -->
      <div class="files-panel" *ngIf="showFiles">
        <div class="files-header">
          <h4>{{ i18n.t('chat.files') }}</h4>
          <button mat-icon-button (click)="showFiles = false">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        <div *ngFor="let f of files" class="file-item">
          <mat-icon>insert_drive_file</mat-icon>
          <div class="file-info">
            <a [href]="getDownloadUrl(f.id)" target="_blank">{{ f.original_filename }}</a>
            <small>{{ formatFileSize(f.file?.file_size) }}</small>
          </div>
        </div>
        <p *ngIf="files.length === 0" class="no-files">{{ i18n.t('chat.no_files') }}</p>
      </div>

      <!-- Messages -->
      <div class="messages-container" #messagesContainer>
        <div *ngIf="loadingMessages" class="loading">
          <mat-spinner diameter="30"></mat-spinner>
        </div>
        <ng-container *ngFor="let msg of messages; let i = index">
          <!-- New messages divider -->
          <div *ngIf="lastReadMessageId && msg.id === firstUnreadMessageId" class="new-messages-divider" #newMessagesDivider>
            <span class="divider-line"></span>
            <span class="divider-label">{{ i18n.t('chat.new_messages') }}</span>
            <span class="divider-line"></span>
          </div>
          <!-- System message (call started/ended) -->
          <div *ngIf="msg.message_type === 'system'" class="system-message">
            <mat-icon class="system-icon">{{ msg.content.includes('beendet') ? 'call_end' : 'call' }}</mat-icon>
            <span>{{ msg.content }}</span>
            <span class="message-time">{{ formatTime(msg.created_at) }}</span>
          </div>

          <!-- Normal message -->
          <div *ngIf="msg.message_type !== 'system'" class="message" [class.own]="msg.sender_id === currentUser?.id"
               [attr.data-msg-id]="msg.id">
            <div class="message-avatar-wrapper" *ngIf="msg.sender_id !== currentUser?.id">
              <div class="message-avatar">
                <img *ngIf="msg.sender_avatar_path" [src]="getAvatarUrl(msg.sender_avatar_path)" class="msg-avatar-img" alt="">
                <span *ngIf="!msg.sender_avatar_path">{{ msg.sender_name?.charAt(0)?.toUpperCase() || '?' }}</span>
              </div>
              <span class="msg-status-dot" [class]="msg.sender_status || 'offline'"></span>
            </div>
            <div class="message-content">
              <div class="message-header" *ngIf="msg.sender_id !== currentUser?.id">
                <strong>{{ msg.sender_name }}</strong>
                <span class="message-time">{{ formatTime(msg.created_at) }}</span>
              </div>
              <div class="message-bubble" [class.own]="msg.sender_id === currentUser?.id"
                   (contextmenu)="onBubbleContextMenu($event, msg)"
                   (touchstart)="onTouchStart($event, msg)"
                   (touchend)="onTouchEnd()"
                   (touchmove)="onTouchEnd()">
                <!-- Quoted reply -->
                <div *ngIf="msg.reply_to_id" class="reply-quote" (click)="scrollToMessage(msg.reply_to_id)">
                  <strong>{{ msg.reply_to_sender }}</strong>
                  <span>{{ msg.reply_to_content?.substring(0, 100) }}</span>
                </div>
                <ng-container *ngIf="msg.message_type === 'file' && msg.file_reference_id">
                  <!-- Image preview -->
                  <div *ngIf="isImage(msg.content)" class="media-message">
                    <img [src]="getInlineUrl(msg.file_reference_id)" [alt]="getFileName(msg.content)"
                         class="chat-image" loading="lazy" (click)="openMediaFullscreen(msg)">
                    <div class="media-filename">
                      <a [href]="getDownloadUrl(msg.file_reference_id)" target="_blank">{{ getFileName(msg.content) }}</a>
                    </div>
                    <div *ngIf="getCaption(msg.content)" class="media-caption">{{ getCaption(msg.content) }}</div>
                  </div>
                  <!-- Video player -->
                  <div *ngIf="isVideo(msg.content)" class="media-message">
                    <video [src]="getInlineUrl(msg.file_reference_id)" class="chat-video"
                           controls preload="metadata" playsinline></video>
                    <div class="media-filename">
                      <a [href]="getDownloadUrl(msg.file_reference_id)" target="_blank">{{ getFileName(msg.content) }}</a>
                    </div>
                    <div *ngIf="getCaption(msg.content)" class="media-caption">{{ getCaption(msg.content) }}</div>
                  </div>
                  <!-- Generic file -->
                  <div *ngIf="!isImage(msg.content) && !isVideo(msg.content)" class="file-message">
                    <mat-icon>attachment</mat-icon>
                    <a [href]="getDownloadUrl(msg.file_reference_id)" target="_blank">
                      {{ getFileName(msg.content) }}
                    </a>
                    <div *ngIf="getCaption(msg.content)" class="media-caption">{{ getCaption(msg.content) }}</div>
                  </div>
                </ng-container>
                <ng-container *ngIf="msg.message_type !== 'file'">
                  <span *ngIf="editingMessageId !== msg.id" [innerHTML]="highlightMentions(msg.content)"></span>
                  <div *ngIf="editingMessageId === msg.id" class="inline-edit" (click)="$event.stopPropagation()">
                    <input class="inline-edit-input" [(ngModel)]="editMessageValue"
                           (keydown.enter)="saveEditMessage()"
                           (keydown.escape)="cancelEditMessage()">
                    <div class="inline-edit-actions">
                      <button mat-icon-button (click)="saveEditMessage()" class="inline-edit-btn">
                        <mat-icon>check</mat-icon>
                      </button>
                      <button mat-icon-button (click)="cancelEditMessage()" class="inline-edit-btn">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                  </div>
                </ng-container>
                <span *ngIf="msg.edited_at" class="edited">{{ i18n.t('chat.edited') }}</span>
              </div>
              <!-- Reactions display -->
              <div class="reactions-row" *ngIf="msg.reactions && msg.reactions.length > 0">
                <span *ngFor="let r of getGroupedReactions(msg)"
                      class="reaction-badge" [class.own]="r.hasOwn"
                      [matTooltip]="r.names"
                      (click)="toggleReaction(msg, r.emoji)">
                  {{ r.emoji }}<span class="reaction-count">{{ r.count }}</span>
                </span>
              </div>
              <span class="message-time own-time" *ngIf="msg.sender_id === currentUser?.id">
                {{ formatTime(msg.created_at) }}
              </span>
            </div>
          </div>
        </ng-container>

        <div *ngIf="typingUsers.length > 0" class="typing-indicator">
          {{ typingUsers.join(', ') }} {{ typingUsers.length === 1 ? i18n.t('chat.typing_one') : i18n.t('chat.typing_many') }}
        </div>
      </div>

      <!-- Message Context Menu -->
      <div class="msg-context-menu" *ngIf="emojiPickerMsg"
           [style.top.px]="emojiPickerPos.y" [style.left.px]="emojiPickerPos.x">
        <div class="emoji-picker-row">
          <span class="emoji-option emoji-plus" (click)="openFullEmojiPicker()">+</span>
          <span *ngFor="let emoji of EMOJIS" class="emoji-option"
                (click)="selectEmoji(emoji)">{{ emoji }}</span>
        </div>
        <!-- Full emoji grid -->
        <div class="full-emoji-grid" *ngIf="showFullEmojis">
          <div *ngFor="let cat of EMOJI_CATEGORIES" class="emoji-category">
            <div class="emoji-cat-label">{{ cat.label }}</div>
            <div class="emoji-cat-items">
              <span *ngFor="let e of cat.emojis" class="emoji-option"
                    (click)="selectEmoji(e)">{{ e }}</span>
            </div>
          </div>
        </div>
        <div class="context-actions">
          <button class="context-action-btn" (click)="replyToMessage(emojiPickerMsg)">
            <mat-icon>reply</mat-icon>
            <span>{{ i18n.t('chat.reply') }}</span>
          </button>
          <button class="context-action-btn" (click)="forwardMessage(emojiPickerMsg)">
            <mat-icon>forward</mat-icon>
            <span>{{ i18n.t('chat.forward') }}</span>
          </button>
          <button class="context-action-btn" (click)="startEditMessage(emojiPickerMsg)"
                  *ngIf="emojiPickerMsg.sender_id === currentUser?.id && emojiPickerMsg.message_type === 'text'">
            <mat-icon>edit</mat-icon>
            <span>{{ i18n.t('chat.edit') }}</span>
          </button>
          <button class="context-action-btn delete" (click)="confirmDeleteMessage(emojiPickerMsg)"
                  *ngIf="emojiPickerMsg.sender_id === currentUser?.id && emojiPickerMsg.message_type !== 'system'">
            <mat-icon>delete</mat-icon>
            <span>{{ i18n.t('chat.delete') }}</span>
          </button>
        </div>
      </div>

      <!-- Forward dialog -->
      <div class="forward-overlay" *ngIf="forwardingMsg" (click)="cancelForward()">
        <div class="forward-dialog" (click)="$event.stopPropagation()">
          <h3>{{ i18n.t('chat.forward_to') }}</h3>
          <div class="forward-list">
            <div *ngFor="let ch of forwardChannels" class="forward-item" (click)="doForward(ch)">
              <div class="forward-avatar">{{ ch.name?.charAt(0)?.toUpperCase() }}</div>
              <span>{{ ch.name }}</span>
            </div>
            <p *ngIf="forwardChannels.length === 0" class="no-files">{{ i18n.t('chat.no_chats') }}</p>
          </div>
          <button mat-button (click)="cancelForward()" class="forward-cancel">{{ i18n.t('common.cancel') }}</button>
        </div>
      </div>

      <!-- @Mention Autocomplete Popup -->
      <div class="mention-popup" *ngIf="showMentionPopup && mentionResults.length > 0">
        <div *ngFor="let user of mentionResults; let i = index"
             class="mention-item" [class.selected]="i === mentionSelectedIndex"
             (click)="selectMention(user)">
          <div class="mention-avatar-wrapper">
            <div class="mention-avatar">
              <img *ngIf="(user.user || user).avatar_path" [src]="getAvatarUrl((user.user || user).avatar_path)" class="mention-avatar-img" alt="">
              <span *ngIf="!(user.user || user).avatar_path">{{ user.display_name?.charAt(0)?.toUpperCase() }}</span>
            </div>
            <span class="mention-status-dot" [class]="(user.user || user).status || 'offline'"></span>
          </div>
          <div class="mention-info">
            <span class="mention-name">{{ user.display_name }}</span>
            <span class="mention-username">{{'@' + (user.user || user).username}}</span>
          </div>
        </div>
      </div>

      <!-- Reply preview -->
      <div class="reply-bar" *ngIf="replyTo">
        <div class="reply-bar-content">
          <mat-icon class="reply-bar-icon">reply</mat-icon>
          <div class="reply-bar-text">
            <strong>{{ replyTo.sender_name }}</strong>
            <span>{{ replyTo.content?.substring(0, 80) }}{{ replyTo.content?.length > 80 ? '...' : '' }}</span>
          </div>
        </div>
        <button mat-icon-button (click)="cancelReply()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- Input -->
      <div class="pending-file-bar" *ngIf="pendingFile">
        <div class="pending-file-preview">
          <img *ngIf="pendingFile.isImage" [src]="getInlineUrl(pendingFile.ref.id)"
               class="pending-thumb" [alt]="i18n.t('chat.preview')">
          <mat-icon *ngIf="!pendingFile.isImage && !pendingFile.isVideo">insert_drive_file</mat-icon>
          <mat-icon *ngIf="pendingFile.isVideo">videocam</mat-icon>
          <span class="pending-filename">{{ pendingFile.ref.original_filename }}</span>
        </div>
        <button mat-icon-button (click)="cancelPendingFile()" [matTooltip]="i18n.t('common.cancel')">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="message-input-container">
        <button mat-icon-button (click)="fileInput.click()" [matTooltip]="i18n.t('chat.upload_file')">
          <mat-icon>attach_file</mat-icon>
        </button>
        <input type="file" #fileInput hidden (change)="onFileSelected($event)">
        <mat-form-field appearance="outline" class="message-field">
          <input matInput
                 [(ngModel)]="messageText"
                 (keydown)="onKeydown($event)"
                 (input)="onInput()"
                 [placeholder]="pendingFile ? i18n.t('chat.caption_placeholder') : i18n.t('chat.input_placeholder')">
        </mat-form-field>
        <button mat-icon-button color="primary" (click)="sendMessage()" [disabled]="!messageText.trim() && !pendingFile">
          <mat-icon>send</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .chat-room {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: white;
      position: relative;
    }
    .chat-room-header {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: white;
      z-index: 1;
    }
    .channel-info {
      flex: 1;
      margin-left: 8px;
    }
    .channel-info h3 {
      margin: 0;
      font-size: 16px;
    }
    .channel-name-editable {
      cursor: pointer;
      border-radius: 4px;
      padding: 2px 4px;
      margin: -2px -4px;
      transition: background 0.15s;
    }
    .channel-name-editable:hover {
      background: var(--hover, #f3f2f1);
    }
    .edit-name-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .edit-name-input {
      font-size: 16px;
      font-weight: 600;
      border: 1px solid var(--primary, #6264a7);
      border-radius: 4px;
      padding: 2px 8px;
      outline: none;
      min-width: 120px;
      max-width: 250px;
    }
    .edit-name-btn {
      width: 28px !important;
      height: 28px !important;
      line-height: 28px !important;
    }
    .edit-name-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .member-count {
      font-size: 12px;
      color: var(--text-secondary);
      cursor: default;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 300px;
      display: block;
    }
    .header-actions {
      display: flex;
      gap: 4px;
    }
    .files-panel {
      position: absolute;
      right: 0;
      top: 56px;
      bottom: 64px;
      width: 280px;
      background: white;
      border-left: 1px solid var(--border);
      z-index: 2;
      overflow-y: auto;
    }
    .files-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .files-header h4 {
      margin: 0;
    }
    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid #f0f0f0;
    }
    .file-info a {
      color: var(--primary);
      text-decoration: none;
      display: block;
    }
    .file-info small {
      color: var(--text-secondary);
    }
    .no-files {
      text-align: center;
      color: var(--text-secondary);
      padding: 20px;
    }
    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .loading {
      display: flex;
      justify-content: center;
      padding: 20px;
    }
    .message {
      display: flex;
      gap: 8px;
      max-width: 70%;
    }
    .message.own {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    :host ::ng-deep .highlight-msg {
      animation: msg-flash 1.5s ease-out;
    }
    @keyframes msg-flash {
      0%, 30% { background: rgba(98,100,167,0.15); }
      100% { background: transparent; }
    }
    .message-avatar-wrapper {
      position: relative;
      flex-shrink: 0;
    }
    .message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary-light);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 500;
      flex-shrink: 0;
      overflow: hidden;
    }
    .msg-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .msg-status-dot {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid white;
    }
    .msg-status-dot.online { background: var(--online, #92c353); }
    .msg-status-dot.busy { background: var(--busy, #c4314b); }
    .msg-status-dot.away { background: var(--away, #fcba04); }
    .msg-status-dot.dnd { background: var(--busy, #c4314b); }
    .msg-status-dot.offline { background: var(--offline, #93938f); }
    .message-content {
      display: flex;
      flex-direction: column;
    }
    .message-header {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 2px;
    }
    .message-header strong {
      font-size: 13px;
    }
    .message-time {
      font-size: 11px;
      color: var(--text-secondary);
    }
    .own-time {
      align-self: flex-end;
    }
    .message-bubble {
      background: #f0f0f0;
      padding: 8px 12px;
      border-radius: 4px 12px 12px 12px;
      word-break: break-word;
    }
    .message-bubble.own {
      background: #e8e5fc;
      border-radius: 12px 4px 12px 12px;
    }
    .edited {
      font-size: 10px;
      color: var(--text-secondary);
      margin-left: 4px;
    }
    .file-message {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .file-message a {
      color: var(--primary);
    }
    .media-message {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .chat-image {
      max-width: 300px;
      max-height: 300px;
      border-radius: 8px;
      cursor: pointer;
      object-fit: contain;
      transition: opacity 0.2s;
    }
    .chat-image:hover {
      opacity: 0.9;
    }
    .chat-video {
      max-width: 400px;
      max-height: 300px;
      border-radius: 8px;
      background: #000;
      outline: none;
    }
    .media-filename {
      font-size: 11px;
    }
    .media-filename a {
      color: var(--primary);
      text-decoration: none;
    }
    .media-filename a:hover {
      text-decoration: underline;
    }
    /* Fullscreen overlay */
    .media-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      cursor: pointer;
    }
    .media-overlay img {
      max-width: 90vw;
      max-height: 85vh;
      object-fit: contain;
      cursor: default;
    }
    .media-overlay video {
      max-width: 90vw;
      max-height: 85vh;
      cursor: default;
      outline: none;
    }
    .overlay-close {
      position: absolute;
      top: 16px;
      right: 16px;
      color: white !important;
    }
    .overlay-filename {
      color: white;
      margin-top: 12px;
      font-size: 14px;
    }
    .new-messages-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 24px;
      width: 100%;
    }
    .new-messages-divider .divider-line {
      flex: 1;
      height: 1px;
      background: #e53935;
    }
    .new-messages-divider .divider-label {
      color: #e53935;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .system-message {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      color: var(--text-secondary);
      font-size: 13px;
      align-self: center;
      max-width: 100%;
    }
    .system-message .system-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #6264a7;
    }
    .system-message .message-time {
      margin-left: 4px;
    }
    .typing-indicator {
      font-size: 12px;
      color: var(--text-secondary);
      font-style: italic;
      padding: 4px 0;
    }
    /* Pending file preview */
    .pending-file-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 16px;
      background: #f9f8ff;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .pending-file-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .pending-thumb {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 4px;
    }
    .pending-filename {
      font-size: 13px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .media-caption {
      font-size: 13px;
      margin-top: 4px;
      color: #333;
      word-break: break-word;
    }
    .message-input-container {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      border-top: 1px solid var(--border);
      background: white;
      gap: 4px;
    }
    .message-field {
      flex: 1;
    }
    .message-field ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }
    /* Mention popup */
    .mention-popup {
      position: absolute;
      bottom: 64px;
      left: 60px;
      right: 60px;
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-height: 200px;
      overflow-y: auto;
      z-index: 10;
    }
    .mention-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
    }
    .mention-item:hover, .mention-item.selected {
      background: #f0f0ff;
    }
    .mention-avatar-wrapper {
      position: relative;
      flex-shrink: 0;
    }
    .mention-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 500;
      overflow: hidden;
    }
    .mention-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .mention-status-dot {
      position: absolute;
      bottom: -1px;
      right: -1px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1.5px solid white;
    }
    .mention-status-dot.online { background: var(--online, #92c353); }
    .mention-status-dot.busy { background: var(--busy, #c4314b); }
    .mention-status-dot.away { background: var(--away, #fcba04); }
    .mention-status-dot.dnd { background: var(--busy, #c4314b); }
    .mention-status-dot.offline { background: var(--offline, #93938f); }
    .mention-name { font-weight: 500; font-size: 13px; }
    .mention-username { font-size: 11px; color: var(--text-secondary); margin-left: 4px; }
    /* Mention highlighting in messages */
    :host ::ng-deep .mention-highlight {
      color: var(--primary);
      font-weight: 500;
      background: rgba(98,0,238,0.08);
      padding: 1px 3px;
      border-radius: 3px;
    }

    /* Message context menu */
    .msg-context-menu {
      position: fixed;
      background: white;
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      z-index: 50;
      overflow: hidden;
      min-width: 180px;
    }
    .emoji-picker-row {
      display: flex;
      gap: 2px;
      padding: 6px 8px;
      flex-wrap: wrap;
      max-width: 280px;
    }
    .emoji-option {
      font-size: 22px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
      transition: background 0.15s;
      line-height: 1;
      user-select: none;
    }
    .emoji-option:hover {
      background: #f0f0ff;
    }
    .context-actions {
      border-top: 1px solid var(--border, #e1dfdd);
    }
    .context-action-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 14px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      color: #333;
      transition: background 0.12s;
    }
    .context-action-btn:hover {
      background: var(--hover, #f3f2f1);
    }
    .context-action-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #555;
    }
    .context-action-btn.delete:hover {
      background: #fde8e8;
    }
    .context-action-btn.delete mat-icon {
      color: var(--busy, #c4314b);
    }
    /* Inline edit */
    .inline-edit {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 150px;
    }
    .inline-edit-input {
      width: 100%;
      font-size: 14px;
      border: 1px solid var(--primary, #6264a7);
      border-radius: 4px;
      padding: 4px 8px;
      outline: none;
      box-sizing: border-box;
    }
    .inline-edit-actions {
      display: flex;
      gap: 2px;
    }
    .inline-edit-btn {
      width: 26px !important;
      height: 26px !important;
      line-height: 26px !important;
    }
    .inline-edit-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    /* Reply quote inside message bubble */
    .reply-quote {
      background: rgba(0,0,0,0.06);
      border-left: 3px solid var(--primary, #6264a7);
      padding: 4px 8px;
      margin-bottom: 6px;
      border-radius: 2px 4px 4px 2px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .reply-quote strong {
      font-size: 11px;
      color: var(--primary, #6264a7);
    }
    .reply-quote span {
      color: #555;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .message-bubble.own .reply-quote {
      background: rgba(255,255,255,0.35);
    }
    /* Reply bar above input */
    .reply-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 16px;
      background: #f0f0ff;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .reply-bar-content {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }
    .reply-bar-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--primary, #6264a7);
    }
    .reply-bar-text {
      display: flex;
      flex-direction: column;
      font-size: 12px;
      min-width: 0;
    }
    .reply-bar-text strong {
      font-size: 11px;
      color: var(--primary, #6264a7);
    }
    .reply-bar-text span {
      color: #555;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Full emoji grid */
    .emoji-plus {
      font-weight: 700;
      font-size: 20px;
      color: var(--primary, #6264a7);
      line-height: 1;
    }
    .full-emoji-grid {
      max-height: 200px;
      overflow-y: auto;
      border-top: 1px solid var(--border, #e1dfdd);
      padding: 4px 8px;
    }
    .emoji-category {
      margin-bottom: 4px;
    }
    .emoji-cat-label {
      font-size: 10px;
      color: #888;
      padding: 2px 0;
      text-transform: uppercase;
      font-weight: 600;
    }
    .emoji-cat-items {
      display: flex;
      flex-wrap: wrap;
      gap: 1px;
    }
    /* Forward dialog */
    .forward-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .forward-dialog {
      background: white;
      border-radius: 12px;
      padding: 16px;
      width: 320px;
      max-height: 400px;
      display: flex;
      flex-direction: column;
    }
    .forward-dialog h3 {
      margin: 0 0 12px 0;
    }
    .forward-list {
      flex: 1;
      overflow-y: auto;
    }
    .forward-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      cursor: pointer;
      border-radius: 6px;
    }
    .forward-item:hover {
      background: var(--hover, #f3f2f1);
    }
    .forward-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--primary, #6264a7);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .forward-cancel {
      margin-top: 8px;
      align-self: flex-end;
    }
    /* Reactions row under message bubble */
    .reactions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }
    .reaction-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: #f0f0f0;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
    }
    .reaction-badge:hover {
      background: #e8e5fc;
      border-color: var(--primary-light);
    }
    .reaction-badge.own {
      background: #e8e5fc;
      border-color: var(--primary);
    }
    .reaction-count {
      font-size: 11px;
      color: var(--text-secondary);
      font-weight: 500;
    }

    /* ============ Mobile responsive ============ */
    @media (max-width: 768px) {
      .chat-room {
        height: 100%;
        max-height: 100%;
        overflow: hidden;
      }
      .chat-room-header {
        padding: 8px 8px;
        flex-shrink: 0;
      }
      .header-actions {
        gap: 0;
      }
      .header-actions button {
        width: 34px !important;
        height: 34px !important;
        padding: 0 !important;
      }
      .header-actions mat-icon {
        font-size: 20px !important;
        width: 20px !important;
        height: 20px !important;
      }
      .channel-info h3 {
        font-size: 14px;
      }
      .member-count {
        max-width: 120px;
      }
      .chat-image {
        max-width: 220px;
        max-height: 220px;
      }
      .chat-video {
        max-width: 100%;
        max-height: 240px;
      }
      .media-overlay img {
        max-width: 95vw;
        max-height: 80vh;
      }
      .media-overlay video {
        max-width: 95vw;
        max-height: 80vh;
      }
      .messages-container {
        padding: 8px;
      }
      .message-input-container {
        padding: 6px 8px;
        flex-shrink: 0;
      }
      .messages-container {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      .files-panel {
        width: 100%;
        left: 0;
      }
    }
  `],
})
export class ChatRoomComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  channelId = '';
  channel: any = null;
  messages: any[] = [];
  files: any[] = [];
  messageText = '';
  typingUsers: string[] = [];
  currentUser: User | null = null;
  loadingMessages = false;
  showFiles = false;
  fullscreenMedia: { url: string; name: string; type: 'image' | 'video' } | null = null;

  // Rename state
  editingName = false;
  editNameValue = '';

  // Message edit state
  editingMessageId: string | null = null;
  editMessageValue = '';

  // Pending file upload state
  pendingFile: { ref: any; mimeType: string; isImage: boolean; isVideo: boolean } | null = null;

  // Reply state
  replyTo: any = null;

  // Forward state
  forwardingMsg: any = null;
  forwardChannels: any[] = [];

  // Full emoji picker
  showFullEmojis = false;
  readonly EMOJI_CATEGORIES = [
    { label: 'Smileys', emojis: ['\u{1F600}','\u{1F603}','\u{1F604}','\u{1F601}','\u{1F606}','\u{1F605}','\u{1F602}','\u{1F923}','\u{1F60A}','\u{1F607}','\u{1F642}','\u{1F643}','\u{1F609}','\u{1F60C}','\u{1F60D}','\u{1F970}','\u{1F618}','\u{1F617}','\u{1F619}','\u{1F61A}','\u{1F60B}','\u{1F61B}','\u{1F61C}','\u{1F92A}','\u{1F61D}','\u{1F911}','\u{1F917}','\u{1F92D}','\u{1F92B}','\u{1F914}','\u{1F910}','\u{1F928}'] },
    { label: 'Gesten', emojis: ['\u{1F44D}','\u{1F44E}','\u{1F44F}','\u{1F64C}','\u{1F91D}','\u{1F64F}','\u{270D}\u{FE0F}','\u{1F4AA}','\u{1F596}','\u{270C}\u{FE0F}','\u{1F91E}','\u{1F91F}','\u{1F918}','\u{1F448}','\u{1F449}','\u{1F446}','\u{1F447}','\u{261D}\u{FE0F}','\u{270B}','\u{1F91A}','\u{1F590}\u{FE0F}','\u{1F44C}','\u{1F44A}'] },
    { label: 'Herzen', emojis: ['\u{2764}\u{FE0F}','\u{1F9E1}','\u{1F49B}','\u{1F49A}','\u{1F499}','\u{1F49C}','\u{1F5A4}','\u{1F90D}','\u{1F90E}','\u{1F498}','\u{1F49D}','\u{1F496}','\u{1F497}','\u{1F493}','\u{1F49E}','\u{1F495}','\u{1F48C}'] },
    { label: 'Objekte', emojis: ['\u{1F389}','\u{1F388}','\u{1F381}','\u{1F3C6}','\u{1F525}','\u{2B50}','\u{1F31F}','\u{1F4A5}','\u{1F4AF}','\u{1F3B5}','\u{1F3B6}','\u{1F4A1}','\u{1F4A4}','\u{1F4AC}','\u{1F440}','\u{1F4E2}','\u{1F514}','\u{1F50D}','\u{1F512}','\u{1F4CE}','\u{270F}\u{FE0F}','\u{1F4DD}','\u{2705}','\u{274C}','\u{2753}','\u{2757}'] },
    { label: 'Essen', emojis: ['\u{1F354}','\u{1F355}','\u{1F32E}','\u{1F37F}','\u{1F370}','\u{1F36B}','\u{1F369}','\u{1F377}','\u{1F37A}','\u{2615}','\u{1F375}','\u{1F9C3}','\u{1F34E}','\u{1F34C}','\u{1F353}','\u{1F352}','\u{1F347}','\u{1F349}','\u{1F951}'] },
    { label: 'Tiere', emojis: ['\u{1F436}','\u{1F431}','\u{1F42D}','\u{1F439}','\u{1F430}','\u{1F98A}','\u{1F43B}','\u{1F43C}','\u{1F428}','\u{1F42F}','\u{1F981}','\u{1F434}','\u{1F984}','\u{1F42E}','\u{1F437}','\u{1F438}','\u{1F435}','\u{1F427}','\u{1F426}','\u{1F40D}'] },
    { label: 'Wetter', emojis: ['\u{2600}\u{FE0F}','\u{1F324}\u{FE0F}','\u{26C5}','\u{1F325}\u{FE0F}','\u{2601}\u{FE0F}','\u{1F326}\u{FE0F}','\u{1F327}\u{FE0F}','\u{26C8}\u{FE0F}','\u{1F329}\u{FE0F}','\u{2744}\u{FE0F}','\u{1F32C}\u{FE0F}','\u{1F308}','\u{1F319}','\u{1F31E}'] },
  ];

  // Emoji reaction state
  emojiPickerMsg: any = null;
  emojiPickerPos = { x: 0, y: 0 };
  private longPressTimer: any = null;
  readonly EMOJIS = ['\u{1F44D}', '\u{1F44E}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F389}', '\u{1F525}', '\u{1F44F}'];

  // Read position / new messages divider
  lastReadMessageId: string | null = null;
  firstUnreadMessageId: string | null = null;
  private shouldScrollToDivider = false;
  @ViewChild('newMessagesDivider') private newMessagesDivider?: ElementRef;

  // @Mention state
  showMentionPopup = false;
  mentionResults: any[] = [];
  mentionSelectedIndex = 0;
  channelMembers: any[] = [];
  memberNames = '';
  memberNamesShort = '';
  private mentionQuery = '';

  private wsSubscription?: Subscription;
  private paramSubscription?: Subscription;
  private typingTimeout: any;
  private shouldScroll = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private wsService: WebSocketService,
    private authService: AuthService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    public i18n: I18nService,
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();

    // Subscribe to route param changes so navigating between chats works
    this.paramSubscription = this.route.paramMap.subscribe((params) => {
      const newId = params.get('channelId') || '';
      if (newId && newId !== this.channelId) {
        // Disconnect previous channel WS if switching
        if (this.channelId) {
          this.wsSubscription?.unsubscribe();
          this.wsService.disconnect(this.channelId);
        }
        this.channelId = newId;
        this.messages = [];
        this.files = [];
        this.typingUsers = [];
        this.lastReadMessageId = null;
        this.firstUnreadMessageId = null;
        this.loadChannel();
        this.loadReadPositionThenMessages();
        this.loadFiles();
        this.loadChannelMembers();
        this.connectWebSocket();
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToDivider && this.newMessagesDivider) {
      this.shouldScrollToDivider = false;
      this.shouldScroll = false;
      setTimeout(() => {
        this.newMessagesDivider?.nativeElement.scrollIntoView({ block: 'start' });
      });
    } else if (this.shouldScroll) {
      this.scrollToBottom();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.emojiPickerMsg) {
      const target = event.target as HTMLElement;
      if (!target.closest('.msg-context-menu')) {
        this.closeEmojiPicker();
      }
    }
  }

  ngOnDestroy(): void {
    this.saveReadPosition();
    this.paramSubscription?.unsubscribe();
    this.wsSubscription?.unsubscribe();
    this.wsService.disconnect(this.channelId);
  }

  loadChannel(): void {
    this.apiService.getChannel(this.channelId).subscribe((ch) => {
      this.channel = ch;
    });
  }

  loadReadPositionThenMessages(): void {
    this.loadingMessages = true;
    this.apiService.getReadPosition(this.channelId).subscribe({
      next: (pos) => {
        this.lastReadMessageId = pos.last_read_message_id;
        this.loadMessages();
      },
      error: () => {
        this.lastReadMessageId = null;
        this.loadMessages();
      },
    });
  }

  loadMessages(): void {
    this.apiService.getMessages(this.channelId).subscribe({
      next: (msgs) => {
        this.messages = msgs;
        this.loadingMessages = false;
        this.computeFirstUnread();
        if (this.firstUnreadMessageId) {
          this.shouldScrollToDivider = true;
        } else {
          this.shouldScroll = true;
        }
      },
      error: () => { this.loadingMessages = false; },
    });
  }

  private computeFirstUnread(): void {
    this.firstUnreadMessageId = null;
    if (!this.lastReadMessageId || this.messages.length === 0) return;

    const idx = this.messages.findIndex(m => m.id === this.lastReadMessageId);
    if (idx === -1) {
      // Last read message not in current batch - all messages are new
      this.firstUnreadMessageId = this.messages[0]?.id || null;
    } else if (idx < this.messages.length - 1) {
      // There are messages after the last read one
      this.firstUnreadMessageId = this.messages[idx + 1].id;
    }
    // If idx is the last message, there are no unread messages
  }

  saveReadPosition(): void {
    if (this.messages.length === 0 || !this.channelId) return;
    const lastMsg = this.messages[this.messages.length - 1];
    if (!lastMsg) return;
    // Only update if position changed
    if (lastMsg.id !== this.lastReadMessageId) {
      this.apiService.updateReadPosition(this.channelId, lastMsg.id).subscribe();
    }
  }

  loadFiles(): void {
    this.apiService.getChannelFiles(this.channelId).subscribe((files) => {
      this.files = files;
    });
  }

  loadChannelMembers(): void {
    this.apiService.getChannelMembers(this.channelId).subscribe((members) => {
      this.channelMembers = members;
      this.updateMemberNames();
    });
  }

  private updateMemberNames(): void {
    const names = this.channelMembers.map((m: any) => {
      const user = m.user || m;
      return user.display_name || user.username;
    });
    this.memberNames = names.join(', ');
    const maxShow = 3;
    if (names.length <= maxShow) {
      this.memberNamesShort = names.join(', ');
    } else {
      this.memberNamesShort = names.slice(0, maxShow).join(', ') + ` +${names.length - maxShow}`;
    }
  }

  connectWebSocket(): void {
    this.wsSubscription = this.wsService.connect(this.channelId).subscribe((msg) => {
      switch (msg.type) {
        case 'new_message':
          this.messages.push(msg.message);
          this.shouldScroll = true;
          this.typingUsers = this.typingUsers.filter((u) => u !== msg.message.sender_name);
          // Clear the divider since user is actively viewing
          this.firstUnreadMessageId = null;
          this.lastReadMessageId = msg.message.id;
          break;
        case 'typing':
          if (!this.typingUsers.includes(msg.display_name)) {
            this.typingUsers.push(msg.display_name);
            setTimeout(() => {
              this.typingUsers = this.typingUsers.filter((u) => u !== msg.display_name);
            }, 3000);
          }
          break;
        case 'reaction_update':
          this.handleReactionUpdate(msg);
          break;
        case 'member_added':
          if (this.channel) {
            this.channel.member_count = msg.member_count;
            if (msg.channel_name) {
              this.channel.name = msg.channel_name;
            }
          }
          this.loadChannelMembers();
          break;
        case 'member_left':
          if (this.channel) {
            this.channel.member_count = msg.member_count;
            if (msg.channel_name) {
              this.channel.name = msg.channel_name;
            }
          }
          this.loadChannelMembers();
          break;
        case 'message_edited': {
          const edited = this.messages.find((m) => m.id === msg.message_id);
          if (edited) {
            edited.content = msg.content;
            edited.edited_at = msg.edited_at;
          }
          break;
        }
        case 'message_deleted':
          this.messages = this.messages.filter((m) => m.id !== msg.message_id);
          break;
        case 'channel_renamed':
          if (this.channel && msg.channel_name) {
            this.channel.name = msg.channel_name;
          }
          break;
        case 'user_joined':
        case 'user_left':
          break;
      }
    });
  }

  sendMessage(): void {
    const text = this.messageText.trim();
    this.showMentionPopup = false;

    // Build reply payload
    const replyPayload: any = {};
    if (this.replyTo) {
      replyPayload.reply_to_id = this.replyTo.id;
      replyPayload.reply_to_content = (this.replyTo.content || '').substring(0, 150);
      replyPayload.reply_to_sender = this.replyTo.sender_name || '';
    }

    // Send pending file (with optional caption)
    if (this.pendingFile) {
      let content = `Datei: ${this.pendingFile.ref.original_filename}\nmime:${this.pendingFile.mimeType}`;
      if (text) {
        content += `\ncaption:${text}`;
      }
      this.wsService.send(this.channelId, {
        type: 'message',
        content,
        message_type: 'file',
        file_reference_id: this.pendingFile.ref.id,
        ...replyPayload,
      });
      this.loadFiles();
      this.pendingFile = null;
      this.messageText = '';
      this.replyTo = null;
      return;
    }

    // Normal text message
    if (!text) return;
    this.wsService.send(this.channelId, {
      type: 'message',
      content: text,
      message_type: 'text',
      ...replyPayload,
    });
    this.messageText = '';
    this.replyTo = null;
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.showMentionPopup && this.mentionResults.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.mentionSelectedIndex = Math.min(this.mentionSelectedIndex + 1, this.mentionResults.length - 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.mentionSelectedIndex = Math.max(this.mentionSelectedIndex - 1, 0);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && this.showMentionPopup)) {
        event.preventDefault();
        this.selectMention(this.mentionResults[this.mentionSelectedIndex]);
        return;
      }
      if (event.key === 'Escape') {
        this.showMentionPopup = false;
        return;
      }
    }
    if (event.key === 'Enter' && !this.showMentionPopup) {
      if (this.messageText.trim() || this.pendingFile) {
        event.preventDefault();
        this.sendMessage();
      }
    }
  }

  onInput(): void {
    // Check for @mention
    const cursorPos = (document.activeElement as HTMLInputElement)?.selectionStart || this.messageText.length;
    const textBefore = this.messageText.substring(0, cursorPos);
    const mentionMatch = textBefore.match(/@(\S*)$/);

    if (mentionMatch) {
      this.mentionQuery = mentionMatch[1].toLowerCase();
      this.mentionSelectedIndex = 0;
      if (this.mentionQuery.length >= 1) {
        this.mentionResults = this.channelMembers.filter((m: any) => {
          const user = m.user || m;
          const name = (user.display_name || '').toLowerCase();
          const uname = (user.username || '').toLowerCase();
          return name.includes(this.mentionQuery) || uname.includes(this.mentionQuery);
        }).slice(0, 8);
        this.showMentionPopup = this.mentionResults.length > 0;
      } else {
        // Show all members when just "@" is typed
        this.mentionResults = this.channelMembers.slice(0, 8);
        this.showMentionPopup = this.mentionResults.length > 0;
      }
    } else {
      this.showMentionPopup = false;
    }

    // Typing indicator
    clearTimeout(this.typingTimeout);
    this.wsService.send(this.channelId, { type: 'typing' });
    this.typingTimeout = setTimeout(() => {}, 3000);
  }

  selectMention(memberOrUser: any): void {
    const user = memberOrUser.user || memberOrUser;
    const mentionText = user.display_name.includes(' ')
      ? `@"${user.display_name}"`
      : `@${user.username}`;

    // Replace the @query with the selected mention
    const cursorPos = (document.activeElement as HTMLInputElement)?.selectionStart || this.messageText.length;
    const textBefore = this.messageText.substring(0, cursorPos);
    const textAfter = this.messageText.substring(cursorPos);
    const newBefore = textBefore.replace(/@\S*$/, mentionText + ' ');
    this.messageText = newBefore + textAfter;
    this.showMentionPopup = false;
  }

  highlightMentions(content: string): string {
    if (!content) return '';
    // Escape HTML
    let safe = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Highlight @"Name" and @username patterns
    safe = safe.replace(/@&quot;([^&]+)&quot;|@(\S+)/g,
      '<span class="mention-highlight">$&</span>');
    // Also handle non-escaped quotes
    safe = safe.replace(/@"([^"]+)"/g,
      '<span class="mention-highlight">$&</span>');
    return safe;
  }

  // ---- Emoji Reaction methods ----

  onBubbleContextMenu(event: MouseEvent, msg: any): void {
    if (msg.message_type === 'system') return;
    event.preventDefault();
    this.showEmojiPicker(event.clientX, event.clientY, msg);
  }

  onTouchStart(event: TouchEvent, msg: any): void {
    if (msg.message_type === 'system') return;
    this.longPressTimer = setTimeout(() => {
      const touch = event.touches[0];
      if (touch) {
        this.showEmojiPicker(touch.clientX, touch.clientY - 60, msg);
      }
    }, 500);
  }

  onTouchEnd(): void {
    clearTimeout(this.longPressTimer);
  }

  private showEmojiPicker(x: number, y: number, msg: any): void {
    // Position the picker near the click/touch, but within viewport
    const pickerWidth = 280;
    const pickerHeight = 48;
    const adjustedX = Math.min(x, window.innerWidth - pickerWidth - 8);
    const adjustedY = Math.max(8, y - pickerHeight - 8);
    this.emojiPickerMsg = msg;
    this.emojiPickerPos = { x: Math.max(8, adjustedX), y: adjustedY };
  }

  closeEmojiPicker(): void {
    this.emojiPickerMsg = null;
    this.showFullEmojis = false;
  }

  selectEmoji(emoji: string): void {
    if (!this.emojiPickerMsg) return;
    const msg = this.emojiPickerMsg;
    this.closeEmojiPicker();
    this.addReaction(msg, emoji);
  }

  private addReaction(msg: any, emoji: string): void {
    // Optimistically add reaction
    if (!msg.reactions) msg.reactions = [];
    const existing = msg.reactions.find(
      (r: any) => r.emoji === emoji && r.user_id === this.currentUser?.id
    );
    if (existing) {
      // Already reacted - remove instead
      this.removeReaction(msg, emoji);
      return;
    }
    msg.reactions.push({ emoji, user_id: this.currentUser?.id, display_name: this.currentUser?.display_name || '', message_id: msg.id });

    // Send via WebSocket for real-time broadcast
    this.wsService.send(this.channelId, {
      type: 'reaction',
      message_id: msg.id,
      emoji,
      action: 'add',
    });
  }

  private removeReaction(msg: any, emoji: string): void {
    if (!msg.reactions) return;
    msg.reactions = msg.reactions.filter(
      (r: any) => !(r.emoji === emoji && r.user_id === this.currentUser?.id)
    );

    this.wsService.send(this.channelId, {
      type: 'reaction',
      message_id: msg.id,
      emoji,
      action: 'remove',
    });
  }

  toggleReaction(msg: any, emoji: string): void {
    const hasOwn = (msg.reactions || []).some(
      (r: any) => r.emoji === emoji && r.user_id === this.currentUser?.id
    );
    if (hasOwn) {
      this.removeReaction(msg, emoji);
    } else {
      this.addReaction(msg, emoji);
    }
  }

  getGroupedReactions(msg: any): { emoji: string; count: number; hasOwn: boolean; names: string }[] {
    if (!msg.reactions || msg.reactions.length === 0) return [];
    const groups: { [key: string]: { count: number; hasOwn: boolean; names: string[] } } = {};
    for (const r of msg.reactions) {
      if (!groups[r.emoji]) {
        groups[r.emoji] = { count: 0, hasOwn: false, names: [] };
      }
      groups[r.emoji].count++;
      if (r.display_name) {
        groups[r.emoji].names.push(r.display_name);
      }
      if (r.user_id === this.currentUser?.id) {
        groups[r.emoji].hasOwn = true;
      }
    }
    return Object.entries(groups).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      hasOwn: data.hasOwn,
      names: data.names.join(', '),
    }));
  }

  private handleReactionUpdate(data: any): void {
    const msg = this.messages.find((m) => m.id === data.message_id);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = [];

    if (data.action === 'add') {
      // Avoid duplicates
      const exists = msg.reactions.some(
        (r: any) => r.emoji === data.emoji && r.user_id === data.user_id
      );
      if (!exists) {
        msg.reactions.push({ emoji: data.emoji, user_id: data.user_id, display_name: data.display_name || '', message_id: data.message_id });
      }
    } else {
      msg.reactions = msg.reactions.filter(
        (r: any) => !(r.emoji === data.emoji && r.user_id === data.user_id)
      );
    }
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    this.apiService.uploadFile(file, this.channelId).subscribe((ref) => {
      const mimeType = ref.file?.mime_type || file.type || '';
      this.pendingFile = {
        ref,
        mimeType,
        isImage: mimeType.startsWith('image/'),
        isVideo: mimeType.startsWith('video/'),
      };
    });
    // Reset file input so the same file can be selected again
    event.target.value = '';
  }

  cancelPendingFile(): void {
    this.pendingFile = null;
  }

  // ---- Reply methods ----

  replyToMessage(msg: any): void {
    this.closeEmojiPicker();
    this.replyTo = msg;
  }

  cancelReply(): void {
    this.replyTo = null;
  }

  scrollToMessage(messageId: string): void {
    const el = this.messagesContainer?.nativeElement?.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-msg');
      setTimeout(() => el.classList.remove('highlight-msg'), 1500);
    }
  }

  // ---- Forward methods ----

  forwardMessage(msg: any): void {
    this.closeEmojiPicker();
    this.forwardingMsg = msg;
    this.apiService.getChannels().subscribe((channels) => {
      this.forwardChannels = channels.filter((ch: any) => ch.id !== this.channelId);
    });
  }

  cancelForward(): void {
    this.forwardingMsg = null;
    this.forwardChannels = [];
  }

  doForward(targetChannel: any): void {
    if (!this.forwardingMsg) return;
    const fwd = this.forwardingMsg;
    const senderName = fwd.sender_name || this.i18n.t('chat.unknown');
    const content = `[${this.i18n.t('chat.forwarded_from')} ${senderName}]\n${fwd.content}`;
    this.apiService.sendMessage(targetChannel.id, {
      content,
      message_type: fwd.message_type === 'file' ? 'file' : 'text',
      file_reference_id: fwd.file_reference_id || undefined,
    }).subscribe(() => {
      this.snackBar.open(`${this.i18n.t('chat.forwarded_to')} "${targetChannel.name}"`, this.i18n.t('common.ok'), { duration: 2000 });
    });
    this.cancelForward();
  }

  // ---- Full Emoji Picker ----

  openFullEmojiPicker(): void {
    this.showFullEmojis = !this.showFullEmojis;
  }

  openInviteDialog(): void {
    const dialogRef = this.dialog.open(InviteDialogComponent, {
      width: '500px',
      data: {
        channelId: this.channelId,
        inviteToken: this.channel?.invite_token || '',
        channelType: this.channel?.channel_type || '',
      },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result?.redirectTo) {
        // A new group channel was created from a direct chat
        this.router.navigate(['/chat', result.redirectTo]);
        return;
      }
      this.loadChannel();
      this.loadChannelMembers();
    });
  }

  toggleSubscription(): void {
    if (!this.channelId || !this.channel) return;
    this.apiService.toggleChannelSubscription(this.channelId).subscribe({
      next: (res) => {
        this.channel.is_subscribed = res.is_subscribed;
        const msg = res.is_subscribed ? this.i18n.t('chat.subscribed') : this.i18n.t('chat.unsubscribed');
        this.snackBar.open(msg, this.i18n.t('common.ok'), { duration: 2000 });
      },
      error: () => {
        this.snackBar.open(this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  leaveChannel(): void {
    if (!this.channelId) return;
    this.apiService.leaveChannel(this.channelId).subscribe({
      next: () => {
        this.snackBar.open(this.i18n.t('chat.left'), this.i18n.t('common.ok'), { duration: 2000 });
        this.router.navigate(['/chat']);
      },
      error: (err) => {
        const detail = err.error?.detail || this.i18n.t('chat.leave_error');
        this.snackBar.open(detail, this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  startAudioCall(): void {
    this.router.navigate(['/video', this.channelId], { queryParams: { audio: 'true' } });
  }

  startVideoCall(): void {
    this.router.navigate(['/video', this.channelId]);
  }

  goBack(): void {
    if (this.router.url.startsWith('/teams/chat/')) {
      this.router.navigate(['/teams']);
    } else {
      this.router.navigate(['/chat']);
    }
  }

  startEditName(): void {
    if (!this.channel) return;
    this.editingName = true;
    this.editNameValue = this.channel.name || '';
    setTimeout(() => {
      const input = document.querySelector('.edit-name-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  saveChannelName(): void {
    const newName = this.editNameValue.trim();
    if (!newName || !this.channel || newName === this.channel.name) {
      this.cancelEditName();
      return;
    }
    this.apiService.updateChannel(this.channelId, { name: newName }).subscribe({
      next: (updated) => {
        this.channel.name = updated.name;
        this.editingName = false;
      },
      error: (err) => {
        const detail = err.error?.detail || this.i18n.t('chat.rename_error');
        this.snackBar.open(detail, this.i18n.t('common.ok'), { duration: 3000 });
        this.editingName = false;
      },
    });
  }

  cancelEditName(): void {
    this.editingName = false;
    this.editNameValue = '';
  }

  // ---- Message Edit / Delete methods ----

  startEditMessage(msg: any): void {
    this.closeEmojiPicker();
    this.editingMessageId = msg.id;
    this.editMessageValue = msg.content || '';
    setTimeout(() => {
      const input = document.querySelector('.inline-edit-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  saveEditMessage(): void {
    const newContent = this.editMessageValue.trim();
    if (!newContent || !this.editingMessageId) {
      this.cancelEditMessage();
      return;
    }
    const msg = this.messages.find((m) => m.id === this.editingMessageId);
    if (msg && newContent !== msg.content) {
      this.wsService.send(this.channelId, {
        type: 'edit_message',
        message_id: this.editingMessageId,
        content: newContent,
      });
    }
    this.editingMessageId = null;
    this.editMessageValue = '';
  }

  cancelEditMessage(): void {
    this.editingMessageId = null;
    this.editMessageValue = '';
  }

  confirmDeleteMessage(msg: any): void {
    this.closeEmojiPicker();
    if (confirm(this.i18n.t('chat.confirm_delete'))) {
      this.wsService.send(this.channelId, {
        type: 'delete_message',
        message_id: msg.id,
      });
    }
  }

  getAvatarUrl(avatarPath: string | null): string | null {
    return this.apiService.getAvatarUrl(avatarPath);
  }

  getDownloadUrl(refId: string): string {
    return this.apiService.getFileDownloadUrl(refId);
  }

  getInlineUrl(refId: string): string {
    return this.apiService.getFileInlineUrl(refId);
  }

  getFileName(content: string): string {
    if (!content) return this.i18n.t('chat.download_file');
    // Strip mime: line if present
    const firstLine = content.split('\n')[0];
    if (firstLine.startsWith('Datei: ')) {
      return firstLine.substring(7);
    }
    return firstLine;
  }

  getCaption(content: string): string {
    if (!content) return '';
    const match = content.match(/\ncaption:(.+)$/);
    return match ? match[1] : '';
  }

  private getMimeFromContent(content: string): string {
    if (!content) return '';
    const mimeMatch = content.match(/\nmime:([^\n]+)/);
    return mimeMatch ? mimeMatch[1] : '';
  }

  private getExtension(content: string): string {
    const name = this.getFileName(content);
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
  }

  private static IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
  private static VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv']);

  isImage(content: string): boolean {
    const mime = this.getMimeFromContent(content);
    if (mime.startsWith('image/')) return true;
    return ChatRoomComponent.IMAGE_EXTS.has(this.getExtension(content));
  }

  isVideo(content: string): boolean {
    const mime = this.getMimeFromContent(content);
    if (mime.startsWith('video/')) return true;
    return ChatRoomComponent.VIDEO_EXTS.has(this.getExtension(content));
  }

  openMediaFullscreen(msg: any): void {
    this.fullscreenMedia = {
      url: this.getInlineUrl(msg.file_reference_id),
      name: this.getFileName(msg.content),
      type: this.isVideo(msg.content) ? 'video' : 'image',
    };
  }

  closeMediaFullscreen(): void {
    this.fullscreenMedia = null;
  }

  formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(this.i18n.lang, { hour: '2-digit', minute: '2-digit' });
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  private scrollToBottom(): void {
    try {
      this.messagesContainer.nativeElement.scrollTop =
        this.messagesContainer.nativeElement.scrollHeight;
      this.shouldScroll = false;
    } catch (err) {}
  }
}
