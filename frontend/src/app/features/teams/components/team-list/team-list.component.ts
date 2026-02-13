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
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-create-team-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Neues Team erstellen</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Teamname</mat-label>
        <input matInput [(ngModel)]="name" required>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Beschreibung</mat-label>
        <textarea matInput [(ngModel)]="description" rows="3"></textarea>
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
export class CreateTeamDialogComponent {
  name = '';
  description = '';
}

@Component({
  selector: 'app-team-list',
  standalone: true,
  imports: [
    CommonModule, MatListModule, MatIconModule, MatButtonModule,
    MatCardModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="teams-container">
      <div class="teams-header">
        <h2>Teams</h2>
        <button mat-raised-button color="primary" (click)="createTeam()">
          <mat-icon>add</mat-icon> Neues Team
        </button>
      </div>

      <div *ngIf="loading" class="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <div *ngIf="!loading && teams.length === 0" class="empty-state">
        <mat-icon>groups</mat-icon>
        <p>Du bist noch in keinem Team</p>
        <button mat-raised-button color="primary" (click)="createTeam()">
          Team erstellen
        </button>
      </div>

      <div class="teams-grid" *ngIf="!loading && teams.length > 0">
        <mat-card *ngFor="let team of teams" class="team-card" (click)="openTeam(team.id)">
          <mat-card-header>
            <div mat-card-avatar class="team-avatar">
              {{ team.name.charAt(0).toUpperCase() }}
            </div>
            <mat-card-title>{{ team.name }}</mat-card-title>
            <mat-card-subtitle>{{ team.member_count }} Mitglieder</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content *ngIf="team.description">
            <p>{{ team.description }}</p>
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .teams-container {
      height: 100%;
      overflow-y: auto;
      background: white;
    }
    .teams-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    .teams-header h2 {
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
    .teams-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      padding: 24px;
    }
    .team-card {
      cursor: pointer;
      transition: box-shadow 0.2s;
    }
    .team-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .team-avatar {
      width: 40px;
      height: 40px;
      border-radius: 4px;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
      font-size: 18px;
    }
  `],
})
export class TeamListComponent implements OnInit {
  teams: any[] = [];
  loading = false;

  constructor(
    private apiService: ApiService,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadTeams();
  }

  loadTeams(): void {
    this.loading = true;
    this.apiService.getTeams().subscribe({
      next: (teams) => {
        this.teams = teams;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  openTeam(id: string): void {
    this.router.navigate(['/teams', id]);
  }

  createTeam(): void {
    const dialogRef = this.dialog.open(CreateTeamDialogComponent, {
      width: '400px',
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.apiService.createTeam(result).subscribe(() => {
          this.loadTeams();
        });
      }
    });
  }
}
