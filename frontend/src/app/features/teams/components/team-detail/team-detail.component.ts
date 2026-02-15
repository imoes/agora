import { Component, OnInit, OnDestroy, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-create-channel-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Neuer Kanal</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Kanalname</mat-label>
        <input matInput [(ngModel)]="name" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Beschreibung</mat-label>
        <textarea matInput [(ngModel)]="description" rows="2"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Abbrechen</button>
      <button mat-raised-button color="primary" [mat-dialog-close]="{name, description}" [disabled]="!name">
        Erstellen
      </button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; }`],
})
export class CreateChannelDialogComponent {
  name = '';
  description = '';
}

@Component({
  selector: 'app-team-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatListModule, MatIconModule, MatButtonModule,
    MatTabsModule, MatChipsModule, MatSnackBarModule,
  ],
  template: `
    <div class="team-detail">
      <div class="team-header" *ngIf="team">
        <div class="team-info">
          <div class="team-avatar">{{ team.name?.charAt(0)?.toUpperCase() }}</div>
          <div>
            <h2>{{ team.name }}</h2>
            <p>{{ team.description || 'Kein Beschreibung' }}</p>
          </div>
        </div>
      </div>

      <mat-tab-group>
        <mat-tab label="Kanale">
          <div class="tab-content">
            <div class="tab-header">
              <button mat-raised-button color="primary" (click)="createChannel()">
                <mat-icon>add</mat-icon> Neuer Kanal
              </button>
            </div>
            <mat-list>
              <mat-list-item *ngFor="let ch of channels" (click)="openChannel(ch.id)" class="channel-item">
                <mat-icon matListItemIcon>tag</mat-icon>
                <div matListItemTitle>{{ ch.name }}</div>
                <div matListItemLine>{{ ch.member_count }} Mitglieder</div>
                <span *ngIf="ch.unread_count > 0" class="unread-badge" matListItemMeta>
                  {{ ch.unread_count }}
                </span>
              </mat-list-item>
            </mat-list>
          </div>
        </mat-tab>

        <mat-tab label="Mitglieder">
          <div class="tab-content">
            <div class="tab-header search-container">
              <div class="member-search">
                <mat-icon class="search-icon">search</mat-icon>
                <input type="text" [(ngModel)]="memberSearchQuery"
                       (ngModelChange)="onMemberSearchChange($event)"
                       (focus)="showSearchResults = true"
                       placeholder="Benutzer suchen und hinzufuegen...">
              </div>
              <div *ngIf="showSearchResults && memberSearchQuery && memberSearchQuery.length >= 2" class="search-results">
              <div *ngIf="memberSearchLoading" class="search-hint">Suche...</div>
              <div *ngFor="let u of memberSearchResults" class="search-result-item">
                <div class="member-avatar">
                  {{ u.display_name?.charAt(0)?.toUpperCase() }}
                </div>
                <div class="search-result-info">
                  <span class="search-result-name">{{ u.display_name }}</span>
                  <span class="search-result-email">{{ u.email }}</span>
                </div>
                <button mat-raised-button color="primary" class="add-btn"
                        (click)="addMember(u)" [disabled]="addingUserId === u.id">
                  <mat-icon>person_add</mat-icon> Hinzufuegen
                </button>
              </div>
              <div *ngIf="!memberSearchLoading && memberSearchResults.length === 0" class="search-hint">
                Keine Benutzer gefunden
              </div>
              </div>
            </div>
            <mat-list>
              <mat-list-item *ngFor="let m of members">
                <div matListItemAvatar class="member-avatar">
                  {{ m.user?.display_name?.charAt(0)?.toUpperCase() }}
                </div>
                <div matListItemTitle>{{ m.user?.display_name }}</div>
                <div matListItemLine>{{ m.role }} &middot; {{ m.user?.email }}</div>
                <button mat-icon-button matListItemMeta
                        *ngIf="m.role !== 'admin'"
                        (click)="removeMember(m.user?.id, m.user?.display_name)">
                  <mat-icon>remove_circle_outline</mat-icon>
                </button>
              </mat-list-item>
            </mat-list>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .team-detail {
      height: 100%;
      overflow-y: auto;
      background: white;
    }
    .team-header {
      padding: 24px;
      border-bottom: 1px solid var(--border);
    }
    .team-info {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .team-avatar {
      width: 48px;
      height: 48px;
      border-radius: 4px;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
      font-size: 22px;
    }
    .team-info h2 {
      margin: 0;
    }
    .team-info p {
      margin: 4px 0 0;
      color: var(--text-secondary);
    }
    .tab-content {
      padding: 16px;
    }
    .tab-header {
      margin-bottom: 16px;
    }
    .search-container {
      position: relative;
    }
    .channel-item {
      cursor: pointer;
    }
    .channel-item:hover {
      background: var(--hover);
    }
    .unread-badge {
      background: var(--primary);
      color: white;
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 12px;
    }
    .member-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--primary-light);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
    }
    .member-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #f9f9f9;
    }
    .search-icon {
      color: #999;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .member-search input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 14px;
      font-family: inherit;
    }
    .search-results {
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .search-result-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid #f0f0f0;
    }
    .search-result-item:last-child {
      border-bottom: none;
    }
    .search-result-info {
      flex: 1;
    }
    .search-result-name {
      display: block;
      font-weight: 500;
      font-size: 14px;
    }
    .search-result-email {
      display: block;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .add-btn {
      font-size: 12px;
      padding: 0 12px;
      height: 32px;
      line-height: 32px;
    }
    .add-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 4px;
    }
    .search-hint {
      text-align: center;
      padding: 16px;
      color: var(--text-secondary);
      font-size: 13px;
    }
  `],
})
export class TeamDetailComponent implements OnInit, OnDestroy {
  team: any;
  channels: any[] = [];
  members: any[] = [];
  teamId: string = '';
  memberSearchQuery = '';
  memberSearchResults: any[] = [];
  memberSearchLoading = false;
  addingUserId: string | null = null;
  showSearchResults = false;
  private searchSubject = new Subject<string>();
  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private elementRef: ElementRef,
  ) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const container = this.elementRef.nativeElement.querySelector('.search-container');
    if (container && !container.contains(event.target)) {
      this.showSearchResults = false;
    }
  }

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId') || '';
    this.loadTeam();
    this.loadChannels();
    this.loadMembers();

    this.subscriptions.push(
      this.searchSubject.pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (query.length < 2) {
            this.memberSearchLoading = false;
            return of([]);
          }
          this.memberSearchLoading = true;
          return this.apiService.searchUsers(query);
        }),
      ).subscribe((users) => {
        const memberIds = new Set(this.members.map((m: any) => m.user?.id));
        this.memberSearchResults = users.filter((u: any) => !memberIds.has(u.id));
        this.memberSearchLoading = false;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  loadTeam(): void {
    this.apiService.getTeam(this.teamId).subscribe((team) => {
      this.team = team;
    });
  }

  loadChannels(): void {
    this.apiService.getChannels(this.teamId).subscribe((channels) => {
      this.channels = channels;
    });
  }

  loadMembers(): void {
    this.apiService.getTeamMembers(this.teamId).subscribe((members) => {
      this.members = members;
    });
  }

  openChannel(channelId: string): void {
    this.router.navigate(['/teams/chat', channelId]);
  }

  createChannel(): void {
    const dialogRef = this.dialog.open(CreateChannelDialogComponent, {
      width: '400px',
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.apiService.createChannel({
          name: result.name,
          description: result.description,
          channel_type: 'team',
          team_id: this.teamId,
        }).subscribe(() => {
          this.loadChannels();
        });
      }
    });
  }

  onMemberSearchChange(query: string): void {
    if (!query) {
      this.memberSearchResults = [];
      this.memberSearchLoading = false;
      return;
    }
    this.searchSubject.next(query);
  }

  addMember(user: any): void {
    this.addingUserId = user.id;
    this.apiService.addTeamMember(this.teamId, user.id).subscribe({
      next: () => {
        this.snackBar.open(`${user.display_name} wurde hinzugefuegt`, 'OK', { duration: 3000 });
        this.memberSearchResults = this.memberSearchResults.filter((u: any) => u.id !== user.id);
        this.addingUserId = null;
        this.loadMembers();
      },
      error: (err) => {
        const detail = err.error?.detail || 'Fehler beim Hinzufuegen';
        this.snackBar.open(detail, 'OK', { duration: 4000 });
        this.addingUserId = null;
      },
    });
  }

  removeMember(userId: string, displayName: string): void {
    if (!confirm(`${displayName} wirklich aus dem Team entfernen?`)) return;
    this.apiService.removeTeamMember(this.teamId, userId).subscribe({
      next: () => {
        this.snackBar.open(`${displayName} wurde entfernt`, 'OK', { duration: 3000 });
        this.loadMembers();
      },
      error: (err) => {
        const detail = err.error?.detail || 'Fehler beim Entfernen';
        this.snackBar.open(detail, 'OK', { duration: 4000 });
      },
    });
  }
}
