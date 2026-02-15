import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '@services/api.service';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-guest-join',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatSnackBarModule],
  template: `
    <div class="guest-join-page">
      <div class="guest-join-card" *ngIf="!error">
        <div class="card-header">
          <mat-icon class="meeting-icon">videocam</mat-icon>
          <h2>Termin beitreten</h2>
        </div>

        <div class="meeting-info" *ngIf="meetingInfo">
          <div class="info-row">
            <mat-icon>event</mat-icon>
            <span class="meeting-title">{{ meetingInfo.event_title }}</span>
          </div>
          <div class="info-row">
            <mat-icon>schedule</mat-icon>
            <span>{{ formatDate(meetingInfo.event_start) }} - {{ formatTime(meetingInfo.event_end) }}</span>
          </div>
        </div>

        <div class="join-form" *ngIf="meetingInfo && !joining">
          <label>Ihr Name:</label>
          <input type="text" [(ngModel)]="displayName" placeholder="Name eingeben"
                 (keydown.enter)="joinMeeting()" autofocus>
          <button class="btn btn-primary" (click)="joinMeeting()" [disabled]="!displayName.trim()">
            <mat-icon>login</mat-icon>
            Beitreten
          </button>
        </div>

        <div class="joining-spinner" *ngIf="joining">
          <span>Beitreten...</span>
        </div>
      </div>

      <div class="guest-join-card error-card" *ngIf="error">
        <mat-icon class="error-icon">error_outline</mat-icon>
        <h2>{{ error }}</h2>
        <p>Der Einladungslink ist ungueltig oder abgelaufen.</p>
      </div>
    </div>
  `,
  styles: [`
    .guest-join-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5f5;
      padding: 24px;
    }
    .guest-join-card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .meeting-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #6200ee;
    }
    .card-header h2 {
      margin: 0;
      font-size: 20px;
      color: #333;
    }
    .meeting-info {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .info-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      color: #555;
    }
    .info-row:last-child { margin-bottom: 0; }
    .info-row mat-icon { font-size: 18px; width: 18px; height: 18px; color: #888; }
    .meeting-title { font-weight: 600; color: #333; }
    .join-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .join-form label {
      font-size: 14px;
      font-weight: 500;
      color: #555;
    }
    .join-form input {
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 15px;
      outline: none;
    }
    .join-form input:focus { border-color: #6200ee; }
    .btn-primary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 24px;
      background: #6200ee;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      cursor: pointer;
    }
    .btn-primary:hover { background: #5000d0; }
    .btn-primary:disabled { background: #ccc; cursor: default; }
    .joining-spinner {
      text-align: center;
      padding: 16px;
      color: #666;
    }
    .error-card {
      text-align: center;
    }
    .error-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #d32f2f;
      margin-bottom: 12px;
    }
    .error-card h2 { color: #d32f2f; }
    .error-card p { color: #666; }
  `],
})
export class GuestJoinComponent implements OnInit {
  displayName = '';
  meetingInfo: any = null;
  error = '';
  joining = false;
  private guestToken = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.guestToken = this.route.snapshot.paramMap.get('token') || '';
    if (!this.guestToken) {
      this.error = 'Einladung nicht gefunden';
      return;
    }

    this.apiService.getGuestMeetingInfo(this.guestToken).subscribe({
      next: (info) => {
        this.meetingInfo = info;
      },
      error: () => {
        this.error = 'Einladung nicht gefunden';
      },
    });
  }

  joinMeeting(): void {
    if (!this.displayName.trim()) return;
    this.joining = true;

    this.apiService.guestJoinMeeting(this.guestToken, this.displayName.trim()).subscribe({
      next: (res) => {
        // Store the guest JWT so they can access the video room
        localStorage.setItem('access_token', res.access_token);
        localStorage.setItem('current_user', JSON.stringify({
          display_name: res.display_name,
          is_guest: true,
        }));
        this.router.navigate(['/video', res.channel_id]);
      },
      error: (err) => {
        this.joining = false;
        const detail = err.error?.detail || 'Beitreten fehlgeschlagen';
        this.snackBar.open(detail, 'OK', { duration: 5000 });
      },
    });
  }

  formatDate(isoStr: string): string {
    const d = new Date(isoStr);
    return d.toLocaleDateString('de-DE', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  formatTime(isoStr: string): string {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
}
