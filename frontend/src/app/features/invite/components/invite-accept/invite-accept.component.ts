import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@services/api.service';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-invite-accept',
  standalone: true,
  imports: [
    CommonModule, MatCardModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="invite-container">
      <mat-card class="invite-card">
        <mat-card-content>
          <div *ngIf="loading" class="loading">
            <mat-spinner diameter="40"></mat-spinner>
            <p>Einladung wird verarbeitet...</p>
          </div>

          <div *ngIf="!loading && success" class="success">
            <mat-icon class="status-icon success-icon">check_circle</mat-icon>
            <h2>{{ statusMessage }}</h2>
            <p *ngIf="channelName">Chat: <strong>{{ channelName }}</strong></p>
            <button mat-raised-button color="primary" (click)="goToChat()">
              <mat-icon>chat</mat-icon>
              Zum Chat
            </button>
          </div>

          <div *ngIf="!loading && !success" class="error">
            <mat-icon class="status-icon error-icon">error</mat-icon>
            <h2>Fehler</h2>
            <p>{{ errorMessage }}</p>
            <button mat-raised-button (click)="goHome()">Zur Startseite</button>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .invite-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f5f5f5;
    }
    .invite-card {
      max-width: 400px;
      width: 100%;
      text-align: center;
      padding: 32px;
    }
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .success, .error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .status-icon { font-size: 64px; width: 64px; height: 64px; }
    .success-icon { color: #4caf50; }
    .error-icon { color: #f44336; }
    h2 { margin: 0; }
  `],
})
export class InviteAcceptComponent implements OnInit {
  loading = true;
  success = false;
  errorMessage = '';
  statusMessage = '';
  channelName = '';
  channelId = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') || '';

    if (!this.authService.isAuthenticated()) {
      // Redirect to login with return URL
      this.router.navigate(['/login'], {
        queryParams: { returnUrl: `/invite/${token}` },
      });
      return;
    }

    this.apiService.acceptInvitation(token).subscribe({
      next: (res) => {
        this.loading = false;
        this.success = true;
        this.channelId = res.channel_id;
        this.channelName = res.channel_name;
        this.statusMessage = res.status === 'already_member'
          ? 'Sie sind bereits Mitglied dieses Chats'
          : 'Erfolgreich beigetreten!';
      },
      error: (err) => {
        this.loading = false;
        this.success = false;
        this.errorMessage = err.error?.detail || 'Ungueltiger oder abgelaufener Einladungs-Link';
      },
    });
  }

  goToChat(): void {
    this.router.navigate(['/chat', this.channelId]);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }
}
