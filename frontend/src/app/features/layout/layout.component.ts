import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService, User } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule, RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatBadgeModule, MatButtonModule, MatMenuModule,
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
            <div class="avatar" [class]="currentUser?.status || 'offline'">
              {{ currentUser?.display_name?.charAt(0)?.toUpperCase() || '?' }}
            </div>
          </div>
          <mat-menu #userMenu="matMenu">
            <div mat-menu-item disabled class="user-info">
              <strong>{{ currentUser?.display_name }}</strong>
              <br>
              <small>{{ currentUser?.email }}</small>
            </div>
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
      position: relative;
    }
    .avatar.online::after {
      content: '';
      position: absolute;
      bottom: 0;
      right: 0;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--online);
      border: 2px solid var(--bg-dark);
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
  `],
})
export class LayoutComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  unreadCount = 0;
  private subscriptions: Subscription[] = [];

  constructor(
    private authService: AuthService,
    private apiService: ApiService
  ) {}

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
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  logout(): void {
    this.authService.logout();
  }
}
