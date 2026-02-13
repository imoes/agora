import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-user-search',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatFormFieldModule, MatInputModule,
    MatIconModule, MatButtonModule, MatListModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="search-container">
      <div class="search-header">
        <h2>Benutzersuche</h2>
      </div>

      <div class="search-input-row">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name, Benutzername oder E-Mail</mat-label>
          <input matInput [(ngModel)]="searchQuery" (ngModelChange)="onSearch($event)"
                 placeholder="Suche...">
          <mat-icon matPrefix>search</mat-icon>
        </mat-form-field>
      </div>

      <div *ngIf="loading" class="loading">
        <mat-spinner diameter="30"></mat-spinner>
      </div>

      <div *ngIf="!loading && searchQuery.length >= 2 && results.length === 0" class="empty">
        <mat-icon>person_off</mat-icon>
        <p>Keine Benutzer gefunden</p>
      </div>

      <mat-list *ngIf="results.length > 0" class="results-list">
        <mat-list-item *ngFor="let user of results" class="user-item" (click)="startChat(user)">
          <div matListItemAvatar class="user-avatar">
            {{ user.display_name?.charAt(0)?.toUpperCase() }}
          </div>
          <div matListItemTitle>
            <strong>{{ user.display_name }}</strong>
            <span class="username">@{{ user.username }}</span>
          </div>
          <div matListItemLine class="user-email">{{ user.email }}</div>
          <button mat-icon-button matListItemMeta matTooltip="Chat starten">
            <mat-icon>chat</mat-icon>
          </button>
        </mat-list-item>
      </mat-list>
    </div>
  `,
  styles: [`
    .search-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: white;
    }
    .search-header {
      display: flex;
      align-items: center;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    .search-header h2 { margin: 0; font-size: 20px; font-weight: 500; }
    .search-input-row {
      padding: 16px 24px 0;
    }
    .full-width { width: 100%; }
    .loading {
      display: flex;
      justify-content: center;
      padding: 40px;
    }
    .empty {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }
    .empty mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 8px;
    }
    .user-item {
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
    }
    .user-item:hover {
      background: var(--hover);
    }
    .user-avatar {
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
    .username {
      color: var(--text-secondary);
      font-weight: normal;
      font-size: 12px;
      margin-left: 6px;
    }
    .user-email {
      color: var(--text-secondary);
      font-size: 12px;
    }
  `],
})
export class UserSearchComponent {
  searchQuery = '';
  results: any[] = [];
  loading = false;
  private searchSubject = new Subject<string>();

  constructor(
    private apiService: ApiService,
    private router: Router,
  ) {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((query) => {
        if (query.length < 2) {
          return of([]);
        }
        this.loading = true;
        return this.apiService.searchUsers(query);
      }),
    ).subscribe((users) => {
      this.results = users;
      this.loading = false;
    });
  }

  onSearch(query: string): void {
    this.searchSubject.next(query);
  }

  startChat(user: any): void {
    this.apiService.findOrCreateDirectChat(user.id).subscribe((channel) => {
      this.router.navigate(['/chat', channel.id]);
    });
  }
}
