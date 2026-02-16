import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '@core/services/auth.service';
import { I18nService } from '@services/i18n.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
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
          <mat-card-subtitle>{{ i18n.t('login.subtitle') }}</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form (ngSubmit)="onLogin()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ i18n.t('login.username') }}</mat-label>
              <input matInput [(ngModel)]="username" name="username" required>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ i18n.t('login.password') }}</mat-label>
              <input matInput type="password" [(ngModel)]="password" name="password" required>
            </mat-form-field>
            <button mat-raised-button color="primary" type="submit" class="full-width" [disabled]="loading">
              {{ loading ? i18n.t('login.submitting') : i18n.t('login.submit') }}
            </button>
          </form>
        </mat-card-content>
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
export class LoginComponent {
  username = '';
  password = '';
  loading = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    public i18n: I18nService,
  ) {}

  onLogin(): void {
    if (!this.username || !this.password) return;
    this.loading = true;
    this.authService.login(this.username, this.password).subscribe({
      next: (res) => {
        // Init language from user profile
        if (res.user?.language) {
          this.i18n.initFromUser(res.user.language);
        }
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(
          err.error?.detail || this.i18n.t('login.error'),
          this.i18n.t('common.ok'),
          { duration: 3000 }
        );
      },
    });
  }
}
