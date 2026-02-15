import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
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
    <div class="chat-room">
      <!-- Header -->
      <div class="chat-room-header">
        <button mat-icon-button (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="channel-info">
          <h3>{{ channel?.name }}</h3>
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
              <div class="message-bubble" [class.own]="msg.sender_id === currentUser?.id">
                <div *ngIf="msg.message_type === 'file'" class="file-message">
                  <mat-icon>attachment</mat-icon>
                  <a *ngIf="msg.file_reference_id" [href]="getDownloadUrl(msg.file_reference_id)" target="_blank">
                    Datei herunterladen
                  </a>
                </div>
                <span *ngIf="msg.message_type !== 'file'" [innerHTML]="highlightMentions(msg.content)"></span>
                <span *ngIf="msg.edited_at" class="edited">(bearbeitet)</span>
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
                 placeholder="Nachricht eingeben... (@  fuer Erwaehnung)">
        </mat-form-field>
        <button mat-icon-button color="primary" (click)="sendMessage()" [disabled]="!messageText.trim()">
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
        case 'user_joined':
        case 'user_left':
          break;
      }
    });
  }

  sendMessage(): void {
    const text = this.messageText.trim();
    if (!text) return;
    this.showMentionPopup = false;
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
      event.preventDefault();
      this.sendMessage();
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

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    this.apiService.uploadFile(file, this.channelId).subscribe((ref) => {
      this.wsService.send(this.channelId, {
        type: 'message',
        content: `Datei: ${ref.original_filename}`,
        message_type: 'file',
        file_reference_id: ref.id,
      });
      this.loadFiles();
    });
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

  getDownloadUrl(refId: string): string {
    return this.apiService.getFileDownloadUrl(refId);
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
