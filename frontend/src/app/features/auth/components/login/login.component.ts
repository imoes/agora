import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSnackBarModule,
  ],
  template: `
    <div class="auth-container">
      <mat-card class="auth-card">
        <mat-card-header>
          <mat-card-title>
            <div class="logo">
              <span class="logo-icon material-icons">groups</span>
              <span class="logo-text">Agora</span>
            </div>
          </mat-card-title>
          <mat-card-subtitle>Melde dich an</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form (ngSubmit)="onLogin()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Benutzername</mat-label>
              <input matInput [(ngModel)]="username" name="username" required>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Passwort</mat-label>
              <input matInput type="password" [(ngModel)]="password" name="password" required>
            </mat-form-field>
            <button mat-raised-button color="primary" type="submit" class="full-width" [disabled]="loading">
              {{ loading ? 'Anmeldung...' : 'Anmelden' }}
            </button>
          </form>
        </mat-card-content>
        <mat-card-actions align="end" *ngIf="registrationEnabled">
          <a routerLink="/register">Noch kein Konto? Registrieren</a>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    .auth-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: linear-gradient(135deg, #6264a7 0%, #464775 100%);
    }
    .auth-card {
      width: 400px;
      padding: 24px;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .logo-icon {
      font-size: 36px;
      color: #6264a7;
    }
    .logo-text {
      font-size: 28px;
      font-weight: 500;
      color: #6264a7;
    }
    .full-width {
      width: 100%;
    }
    mat-form-field {
      margin-bottom: 8px;
    }
    a {
      color: #6264a7;
      text-decoration: none;
    }
  `],
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  loading = false;
  registrationEnabled = true;

  constructor(
    private authService: AuthService,
    private apiService: ApiService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.apiService.getAuthConfig().subscribe((config) => {
      this.registrationEnabled = config.registration_enabled;
    });
  }

  onLogin(): void {
    if (!this.username || !this.password) return;
    this.loading = true;
    this.authService.login(this.username, this.password).subscribe({
      next: () => {
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(
          err.error?.detail || 'Anmeldung fehlgeschlagen',
          'OK',
          { duration: 3000 }
        );
      },
    });
  }
}
