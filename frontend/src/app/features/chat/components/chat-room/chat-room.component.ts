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
              matTooltip="Klicken zum Umbenennen">{{ channel?.name }}</h3>
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
          <button mat-icon-button matTooltip="Mitglied hinzufuegen" (click)="openInviteDialog()">
            <mat-icon>group_add</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Audioanruf" (click)="startAudioCall()">
            <mat-icon>call</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Videoanruf" (click)="startVideoCall()">
            <mat-icon>videocam</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Dateien" (click)="showFiles = !showFiles">
            <mat-icon>attach_file</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Chat verlassen" (click)="leaveChannel()"
                  *ngIf="channel?.channel_type === 'group' || channel?.channel_type === 'meeting'">
            <mat-icon>logout</mat-icon>
          </button>
        </div>
      </div>

      <!-- Files sidebar -->
      <div class="files-panel" *ngIf="showFiles">
        <div class="files-header">
          <h4>Dateien</h4>
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
        <p *ngIf="files.length === 0" class="no-files">Keine Dateien</p>
      </div>

      <!-- Messages -->
      <div class="messages-container" #messagesContainer>
        <div *ngIf="loadingMessages" class="loading">
          <mat-spinner diameter="30"></mat-spinner>
        </div>
        <ng-container *ngFor="let msg of messages">
          <!-- System message (call started/ended) -->
          <div *ngIf="msg.message_type === 'system'" class="system-message">
            <mat-icon class="system-icon">{{ msg.content.includes('beendet') ? 'call_end' : 'call' }}</mat-icon>
            <span>{{ msg.content }}</span>
            <span class="message-time">{{ formatTime(msg.created_at) }}</span>
          </div>

          <!-- Normal message -->
          <div *ngIf="msg.message_type !== 'system'" class="message" [class.own]="msg.sender_id === currentUser?.id">
            <div class="message-avatar" *ngIf="msg.sender_id !== currentUser?.id">
              {{ msg.sender_name?.charAt(0)?.toUpperCase() || '?' }}
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
                <span *ngIf="msg.edited_at" class="edited">(bearbeitet)</span>
              </div>
              <!-- Reactions display -->
              <div class="reactions-row" *ngIf="msg.reactions && msg.reactions.length > 0">
                <span *ngFor="let r of getGroupedReactions(msg)"
                      class="reaction-badge" [class.own]="r.hasOwn"
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
          {{ typingUsers.join(', ') }} {{ typingUsers.length === 1 ? 'tippt...' : 'tippen...' }}
        </div>
      </div>

      <!-- Message Context Menu -->
      <div class="msg-context-menu" *ngIf="emojiPickerMsg"
           [style.top.px]="emojiPickerPos.y" [style.left.px]="emojiPickerPos.x">
        <div class="emoji-picker-row">
          <span *ngFor="let emoji of EMOJIS" class="emoji-option"
                (click)="selectEmoji(emoji)">{{ emoji }}</span>
        </div>
        <div class="context-actions" *ngIf="emojiPickerMsg.sender_id === currentUser?.id && emojiPickerMsg.message_type !== 'system'">
          <button class="context-action-btn" (click)="startEditMessage(emojiPickerMsg)" *ngIf="emojiPickerMsg.message_type !== 'file'">
            <mat-icon>edit</mat-icon>
            <span>Bearbeiten</span>
          </button>
          <button class="context-action-btn delete" (click)="confirmDeleteMessage(emojiPickerMsg)">
            <mat-icon>delete</mat-icon>
            <span>Loeschen</span>
          </button>
        </div>
      </div>

      <!-- @Mention Autocomplete Popup -->
      <div class="mention-popup" *ngIf="showMentionPopup && mentionResults.length > 0">
        <div *ngFor="let user of mentionResults; let i = index"
             class="mention-item" [class.selected]="i === mentionSelectedIndex"
             (click)="selectMention(user)">
          <div class="mention-avatar">{{ user.display_name?.charAt(0)?.toUpperCase() }}</div>
          <div class="mention-info">
            <span class="mention-name">{{ user.display_name }}</span>
            <span class="mention-username">{{'@' + (user.user || user).username}}</span>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="pending-file-bar" *ngIf="pendingFile">
        <div class="pending-file-preview">
          <img *ngIf="pendingFile.isImage" [src]="getInlineUrl(pendingFile.ref.id)"
               class="pending-thumb" alt="Vorschau">
          <mat-icon *ngIf="!pendingFile.isImage && !pendingFile.isVideo">insert_drive_file</mat-icon>
          <mat-icon *ngIf="pendingFile.isVideo">videocam</mat-icon>
          <span class="pending-filename">{{ pendingFile.ref.original_filename }}</span>
        </div>
        <button mat-icon-button (click)="cancelPendingFile()" matTooltip="Abbrechen">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="message-input-container">
        <button mat-icon-button (click)="fileInput.click()" matTooltip="Datei hochladen">
          <mat-icon>attach_file</mat-icon>
        </button>
        <input type="file" #fileInput hidden (change)="onFileSelected($event)">
        <mat-form-field appearance="outline" class="message-field">
          <input matInput
                 [(ngModel)]="messageText"
                 (keydown)="onKeydown($event)"
                 (input)="onInput()"
                 [placeholder]="pendingFile ? 'Kommentar hinzufuegen (optional)...' : 'Nachricht eingeben... (@  fuer Erwaehnung)'">
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
    }
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
    }
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

  // Emoji reaction state
  emojiPickerMsg: any = null;
  emojiPickerPos = { x: 0, y: 0 };
  private longPressTimer: any = null;
  readonly EMOJIS = ['\u{1F44D}', '\u{1F44E}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F389}', '\u{1F525}', '\u{1F44F}'];

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
        this.loadChannel();
        this.loadMessages();
        this.loadFiles();
        this.loadChannelMembers();
        this.connectWebSocket();
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
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
    this.paramSubscription?.unsubscribe();
    this.wsSubscription?.unsubscribe();
    this.wsService.disconnect(this.channelId);
  }

  loadChannel(): void {
    this.apiService.getChannel(this.channelId).subscribe((ch) => {
      this.channel = ch;
    });
  }

  loadMessages(): void {
    this.loadingMessages = true;
    this.apiService.getMessages(this.channelId).subscribe({
      next: (msgs) => {
        this.messages = msgs;
        this.loadingMessages = false;
        this.shouldScroll = true;
      },
      error: () => { this.loadingMessages = false; },
    });
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
      });
      this.loadFiles();
      this.pendingFile = null;
      this.messageText = '';
      return;
    }

    // Normal text message
    if (!text) return;
    this.wsService.send(this.channelId, {
      type: 'message',
      content: text,
      message_type: 'text',
    });
    this.messageText = '';
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
    msg.reactions.push({ emoji, user_id: this.currentUser?.id, message_id: msg.id });

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

  getGroupedReactions(msg: any): { emoji: string; count: number; hasOwn: boolean }[] {
    if (!msg.reactions || msg.reactions.length === 0) return [];
    const groups: { [key: string]: { count: number; hasOwn: boolean } } = {};
    for (const r of msg.reactions) {
      if (!groups[r.emoji]) {
        groups[r.emoji] = { count: 0, hasOwn: false };
      }
      groups[r.emoji].count++;
      if (r.user_id === this.currentUser?.id) {
        groups[r.emoji].hasOwn = true;
      }
    }
    return Object.entries(groups).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      hasOwn: data.hasOwn,
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
        msg.reactions.push({ emoji: data.emoji, user_id: data.user_id, message_id: data.message_id });
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

  leaveChannel(): void {
    if (!this.channelId) return;
    this.apiService.leaveChannel(this.channelId).subscribe({
      next: () => {
        this.snackBar.open('Chat verlassen', 'OK', { duration: 2000 });
        this.router.navigate(['/chat']);
      },
      error: (err) => {
        const detail = err.error?.detail || 'Fehler beim Verlassen';
        this.snackBar.open(detail, 'OK', { duration: 3000 });
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
        const detail = err.error?.detail || 'Fehler beim Umbenennen';
        this.snackBar.open(detail, 'OK', { duration: 3000 });
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
    if (confirm('Nachricht wirklich loeschen?')) {
      this.wsService.send(this.channelId, {
        type: 'delete_message',
        message_id: msg.id,
      });
    }
  }

  getDownloadUrl(refId: string): string {
    return this.apiService.getFileDownloadUrl(refId);
  }

  getInlineUrl(refId: string): string {
    return this.apiService.getFileInlineUrl(refId);
  }

  getFileName(content: string): string {
    if (!content) return 'Datei herunterladen';
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
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
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
