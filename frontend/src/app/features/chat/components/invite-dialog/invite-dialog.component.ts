import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-invite-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule, MatSnackBarModule,
    MatListModule, MatChipsModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>Einladung senden</h2>
    <mat-dialog-content>
      <div class="invite-section">
        <h4>Per E-Mail einladen</h4>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>E-Mail-Adresse</mat-label>
          <input matInput [(ngModel)]="email" type="email" placeholder="user@example.com">
        </mat-form-field>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Nachricht (optional)</mat-label>
          <textarea matInput [(ngModel)]="message" rows="2"></textarea>
        </mat-form-field>
        <button mat-raised-button color="primary" (click)="sendInvite()" [disabled]="!email || sending">
          <mat-icon>send</mat-icon>
          {{ sending ? 'Wird gesendet...' : 'Einladung senden' }}
        </button>
      </div>

      <div class="link-section">
        <h4>Einladungs-Link</h4>
        <div class="invite-link-row">
          <code class="invite-link">{{ inviteUrl }}</code>
          <button mat-icon-button matTooltip="Link kopieren" (click)="copyLink()">
            <mat-icon>content_copy</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Neuen Token generieren" (click)="regenerateToken()">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>
      </div>

      <div class="invitations-section" *ngIf="invitations.length > 0">
        <h4>Gesendete Einladungen</h4>
        <div *ngFor="let inv of invitations" class="invitation-item">
          <div class="inv-info">
            <span class="inv-email">{{ inv.invited_email }}</span>
            <span class="inv-status" [class]="inv.status">{{ statusLabel(inv.status) }}</span>
          </div>
          <div class="inv-actions">
            <button mat-icon-button matTooltip="ICS herunterladen"
                    (click)="downloadIcs(inv.id)" *ngIf="inv.status === 'pending'">
              <mat-icon>event</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Widerrufen"
                    (click)="revokeInvite(inv.id)" *ngIf="inv.status === 'pending'">
              <mat-icon>cancel</mat-icon>
            </button>
          </div>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Schliessen</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .invite-section, .link-section, .invitations-section {
      margin-bottom: 16px;
    }
    h4 { margin: 0 0 8px; color: #555; }
    .invite-link-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f5f5f5;
      padding: 8px 12px;
      border-radius: 4px;
    }
    .invite-link {
      flex: 1;
      font-size: 12px;
      word-break: break-all;
      color: #333;
    }
    .invitation-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .inv-email { font-size: 13px; }
    .inv-status {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      margin-left: 8px;
    }
    .inv-status.pending { background: #fff3e0; color: #e65100; }
    .inv-status.accepted { background: #e8f5e9; color: #2e7d32; }
    .inv-status.declined { background: #fce4ec; color: #c62828; }
    .inv-status.expired { background: #f5f5f5; color: #757575; }
    .inv-actions { display: flex; }
  `],
})
export class InviteDialogComponent {
  email = '';
  message = '';
  sending = false;
  invitations: any[] = [];
  inviteUrl = '';

  constructor(
    private dialogRef: MatDialogRef<InviteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { channelId: string; inviteToken: string },
    private apiService: ApiService,
    private snackBar: MatSnackBar,
  ) {
    this.inviteUrl = `${window.location.origin}/invite/${data.inviteToken}`;
    this.loadInvitations();
  }

  loadInvitations(): void {
    this.apiService.getChannelInvitations(this.data.channelId).subscribe((invs) => {
      this.invitations = invs;
    });
  }

  sendInvite(): void {
    if (!this.email) return;
    this.sending = true;
    this.apiService.sendInvitation(this.data.channelId, {
      email: this.email,
      message: this.message || undefined,
    }).subscribe({
      next: () => {
        this.snackBar.open('Einladung gesendet!', 'OK', { duration: 3000 });
        this.email = '';
        this.message = '';
        this.sending = false;
        this.loadInvitations();
      },
      error: (err) => {
        const detail = err.error?.detail || 'Fehler beim Senden';
        this.snackBar.open(detail, 'OK', { duration: 5000 });
        this.sending = false;
      },
    });
  }

  copyLink(): void {
    navigator.clipboard.writeText(this.inviteUrl).then(() => {
      this.snackBar.open('Link kopiert!', 'OK', { duration: 2000 });
    });
  }

  regenerateToken(): void {
    this.apiService.regenerateInviteToken(this.data.channelId).subscribe((res) => {
      this.data.inviteToken = res.invite_token;
      this.inviteUrl = `${window.location.origin}/invite/${res.invite_token}`;
      this.snackBar.open('Neuer Token generiert!', 'OK', { duration: 2000 });
    });
  }

  downloadIcs(invitationId: string): void {
    window.open(
      this.apiService.getInvitationIcsUrl(this.data.channelId, invitationId),
      '_blank'
    );
  }

  revokeInvite(invitationId: string): void {
    this.apiService.revokeInvitation(invitationId).subscribe({
      next: () => {
        this.snackBar.open('Einladung widerrufen', 'OK', { duration: 2000 });
        this.loadInvitations();
      },
      error: () => {
        this.snackBar.open('Fehler beim Widerrufen', 'OK', { duration: 3000 });
      },
    });
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Ausstehend',
      accepted: 'Angenommen',
      declined: 'Abgelehnt',
      expired: 'Abgelaufen',
    };
    return labels[status] || status;
  }
}
