import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-register',
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
          <mat-card-subtitle>Erstelle ein Konto</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form (ngSubmit)="onRegister()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Anzeigename</mat-label>
              <input matInput [(ngModel)]="displayName" name="displayName" required>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Benutzername</mat-label>
              <input matInput [(ngModel)]="username" name="username" required>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>E-Mail</mat-label>
              <input matInput type="email" [(ngModel)]="email" name="email" required>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Passwort</mat-label>
              <input matInput type="password" [(ngModel)]="password" name="password" required>
            </mat-form-field>
            <button mat-raised-button color="primary" type="submit" class="full-width" [disabled]="loading">
              {{ loading ? 'Registrierung...' : 'Registrieren' }}
            </button>
          </form>
        </mat-card-content>
        <mat-card-actions align="end">
          <a routerLink="/login">Bereits registriert? Anmelden</a>
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
export class RegisterComponent {
  displayName = '';
  username = '';
  email = '';
  password = '';
  loading = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  onRegister(): void {
    if (!this.username || !this.email || !this.password || !this.displayName) return;
    this.loading = true;
    this.authService.register({
      username: this.username,
      email: this.email,
      password: this.password,
      display_name: this.displayName,
    }).subscribe({
      next: () => {
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(
          err.error?.detail || 'Registrierung fehlgeschlagen',
          'OK',
          { duration: 3000 }
        );
      },
    });
  }
}
