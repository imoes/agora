import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [
    CommonModule, MatListModule, MatIconModule, MatButtonModule,
    MatTabsModule, MatBadgeModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="feed-container">
      <div class="feed-header">
        <h2>Feed</h2>
        <button mat-icon-button (click)="loadFeed()" [disabled]="loading">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <mat-tab-group (selectedTabChange)="onTabChange($event)">
        <mat-tab>
          <ng-template mat-tab-label>
            Ungelesen
            <span *ngIf="unreadCount > 0" class="unread-badge">{{ unreadCount }}</span>
          </ng-template>
          <ng-container *ngTemplateOutlet="feedList"></ng-container>
        </mat-tab>
        <mat-tab label="Alle">
          <ng-container *ngTemplateOutlet="feedList"></ng-container>
        </mat-tab>
      </mat-tab-group>

      <ng-template #feedList>
        <div *ngIf="loading" class="loading">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
        <div *ngIf="!loading && events.length === 0" class="empty-state">
          <mat-icon>inbox</mat-icon>
          <p>Keine neuen Nachrichten</p>
        </div>
        <mat-list *ngIf="!loading && events.length > 0">
          <mat-list-item *ngFor="let event of events" class="feed-item"
                         [class.unread]="!event.is_read"
                         (click)="openEvent(event)">
            <div matListItemAvatar class="event-avatar">
              {{ event.sender_name?.charAt(0)?.toUpperCase() || '?' }}
            </div>
            <div matListItemTitle>
              <strong>{{ event.sender_name }}</strong>
              <span class="channel-name"> in {{ event.channel_name }}</span>
            </div>
            <div matListItemLine class="preview">{{ event.preview_text }}</div>
            <div matListItemMeta class="event-time">
              {{ formatTime(event.created_at) }}
            </div>
          </mat-list-item>
        </mat-list>

        <div *ngIf="!loading && events.length > 0" class="load-more">
          <button mat-button (click)="loadMore()">Mehr laden</button>
        </div>
      </ng-template>
    </div>
  `,
  styles: [`
    .feed-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: white;
    }
    .feed-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    .feed-header h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
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
      margin-bottom: 16px;
    }
    .feed-item {
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
    }
    .feed-item:hover {
      background: var(--hover);
    }
    .feed-item.unread {
      background: #f0f0ff;
      border-left: 3px solid var(--primary);
    }
    .event-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
    }
    .channel-name {
      color: var(--text-secondary);
      font-weight: normal;
      font-size: 12px;
    }
    .preview {
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event-time {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .unread-badge {
      background: var(--primary);
      color: white;
      border-radius: 10px;
      padding: 2px 6px;
      font-size: 11px;
      margin-left: 6px;
    }
    .load-more {
      text-align: center;
      padding: 8px;
    }
  `],
})
export class FeedComponent implements OnInit {
  events: any[] = [];
  unreadCount = 0;
  loading = false;
  showUnreadOnly = true;
  offset = 0;

  constructor(private apiService: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.loadFeed();
  }

  loadFeed(): void {
    this.loading = true;
    this.offset = 0;
    this.apiService.getFeed(50, 0, this.showUnreadOnly).subscribe({
      next: (res) => {
        this.events = res.events;
        this.unreadCount = res.unread_count;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  loadMore(): void {
    this.offset += 50;
    this.apiService.getFeed(50, this.offset, this.showUnreadOnly).subscribe((res) => {
      this.events = [...this.events, ...res.events];
    });
  }

  onTabChange(event: any): void {
    this.showUnreadOnly = event.index === 0;
    this.loadFeed();
  }

  openEvent(event: any): void {
    // Mark as read
    this.apiService.markFeedRead({ event_ids: [event.id] }).subscribe();
    event.is_read = true;
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    // Navigate to chat
    this.router.navigate(['/chat', event.channel_id]);
  }

  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Jetzt';
    if (diffMin < 60) return `vor ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `vor ${diffH}h`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }
}
