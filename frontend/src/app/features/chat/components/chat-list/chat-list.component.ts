import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatBadgeModule } from '@angular/material/badge';
import { debounceTime, Subject } from 'rxjs';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-new-chat-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatAutocompleteModule, MatChipsModule, MatListModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>Neuer Chat</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Chatname</mat-label>
        <input matInput [(ngModel)]="name" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Benutzer suchen</mat-label>
        <input matInput [(ngModel)]="searchQuery" (ngModelChange)="onSearch($event)">
      </mat-form-field>
      <mat-list dense *ngIf="searchResults.length > 0">
        <mat-list-item *ngFor="let user of searchResults" (click)="addUser(user)" class="clickable">
          <mat-icon matListItemIcon>person_add</mat-icon>
          <div matListItemTitle>{{ user.display_name }}</div>
          <div matListItemLine>{{ user.username }}</div>
        </mat-list-item>
      </mat-list>
      <div *ngIf="selectedUsers.length > 0" class="selected">
        <strong>Ausgewahlt:</strong>
        <mat-chip-set>
          <mat-chip *ngFor="let u of selectedUsers" (removed)="removeUser(u)">
            {{ u.display_name }}
            <mat-icon matChipRemove>cancel</mat-icon>
          </mat-chip>
        </mat-chip-set>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Abbrechen</button>
      <button mat-raised-button color="primary"
              [mat-dialog-close]="{name, member_ids: selectedUsers.map(u => u.id)}"
              [disabled]="!name || selectedUsers.length === 0">
        Erstellen
      </button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; } .clickable { cursor: pointer; } .selected { margin-top: 12px; }`],
})
export class NewChatDialogComponent {
  name = '';
  searchQuery = '';
  searchResults: any[] = [];
  selectedUsers: any[] = [];

  constructor(private apiService: ApiService) {}

  onSearch(query: string): void {
    if (query.length < 2) {
      this.searchResults = [];
      return;
    }
    this.apiService.searchUsers(query).subscribe((users) => {
      this.searchResults = users.filter(
        (u: any) => !this.selectedUsers.find((s) => s.id === u.id)
      );
    });
  }

  addUser(user: any): void {
    this.selectedUsers.push(user);
    this.searchResults = this.searchResults.filter((u) => u.id !== user.id);
    this.searchQuery = '';
  }

  removeUser(user: any): void {
    this.selectedUsers = this.selectedUsers.filter((u) => u.id !== user.id);
  }
}

@Component({
  selector: 'app-chat-list',
  standalone: true,
  imports: [
    CommonModule, MatListModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatBadgeModule,
  ],
  template: `
    <div class="chat-list-container">
      <div class="chat-header">
        <h2>Chats</h2>
        <button mat-raised-button color="primary" (click)="newChat()">
          <mat-icon>add</mat-icon> Neuer Chat
        </button>
      </div>

      <div *ngIf="loading" class="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <div *ngIf="!loading && channels.length === 0" class="empty-state">
        <mat-icon>chat_bubble_outline</mat-icon>
        <p>Keine Chats vorhanden</p>
        <button mat-raised-button color="primary" (click)="newChat()">
          Chat starten
        </button>
      </div>

      <mat-list *ngIf="!loading && channels.length > 0">
        <mat-list-item *ngFor="let ch of channels" (click)="openChat(ch.id)" class="chat-item">
          <div matListItemAvatar class="chat-avatar" [class.team]="ch.channel_type === 'team'">
            <mat-icon *ngIf="ch.channel_type === 'team'">tag</mat-icon>
            <span *ngIf="ch.channel_type !== 'team'">{{ ch.name?.charAt(0)?.toUpperCase() }}</span>
          </div>
          <div matListItemTitle>
            {{ ch.name }}
            <span *ngIf="ch.unread_count > 0" class="unread-badge">{{ ch.unread_count }}</span>
          </div>
          <div matListItemLine>{{ ch.member_count }} Mitglieder</div>
        </mat-list-item>
      </mat-list>
    </div>
  `,
  styles: [`
    .chat-list-container {
      height: 100%;
      overflow-y: auto;
      background: white;
    }
    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    .chat-header h2 {
      margin: 0;
    }
    .loading {
      display: flex;
      justify-content: center;
      padding: 40px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }
    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
    }
    .chat-item {
      cursor: pointer;
    }
    .chat-item:hover {
      background: var(--hover);
    }
    .chat-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
    }
    .chat-avatar.team {
      border-radius: 4px;
    }
    .unread-badge {
      background: var(--primary);
      color: white;
      border-radius: 10px;
      padding: 2px 6px;
      font-size: 11px;
      margin-left: 8px;
    }
  `],
})
export class ChatListComponent implements OnInit {
  channels: any[] = [];
  loading = false;

  constructor(
    private apiService: ApiService,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadChannels();
  }

  loadChannels(): void {
    this.loading = true;
    this.apiService.getChannels().subscribe({
      next: (channels) => {
        this.channels = channels;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  openChat(channelId: string): void {
    this.router.navigate(['/chat', channelId]);
  }

  newChat(): void {
    const dialogRef = this.dialog.open(NewChatDialogComponent, { width: '450px' });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.apiService.createChannel({
          name: result.name,
          channel_type: 'group',
          member_ids: result.member_ids,
        }).subscribe((ch) => {
          this.router.navigate(['/chat', ch.id]);
        });
      }
    });
  }
}
