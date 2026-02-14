import { Component, OnInit } from '@angular/core';
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
    MatTabsModule, MatChipsModule,
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
            <mat-list>
              <mat-list-item *ngFor="let m of members">
                <div matListItemAvatar class="member-avatar">
                  {{ m.user?.display_name?.charAt(0)?.toUpperCase() }}
                </div>
                <div matListItemTitle>{{ m.user?.display_name }}</div>
                <div matListItemLine>{{ m.role }} &middot; {{ m.user?.email }}</div>
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
  `],
})
export class TeamDetailComponent implements OnInit {
  team: any;
  channels: any[] = [];
  members: any[] = [];
  teamId: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId') || '';
    this.loadTeam();
    this.loadChannels();
    this.loadMembers();
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
}
