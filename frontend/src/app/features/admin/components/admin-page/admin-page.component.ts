import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '@services/api.service';
import { I18nService } from '@services/i18n.service';

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatIconModule, MatButtonModule, MatCardModule,
    MatDividerModule, MatSlideToggleModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatSnackBarModule,
  ],
  template: `
    <div class="admin-page">
      <h2><mat-icon>admin_panel_settings</mat-icon> {{ i18n.t('admin.title') }}</h2>

      <!-- Stats -->
      <mat-card class="admin-card" *ngIf="stats">
        <mat-card-header>
          <mat-card-title>{{ i18n.t('admin.stats') }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-value">{{ stats.total_users }}</span>
              <span class="stat-label">{{ i18n.t('admin.total_users') }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.online_users }}</span>
              <span class="stat-label">{{ i18n.t('admin.online') }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.local_users }}</span>
              <span class="stat-label">{{ i18n.t('admin.local_users') }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.ldap_users }}</span>
              <span class="stat-label">{{ i18n.t('admin.ldap_users') }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.admin_users }}</span>
              <span class="stat-label">{{ i18n.t('admin.admins') }}</span>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- User Management -->
      <mat-card class="admin-card">
        <mat-card-header>
          <mat-card-title>{{ i18n.t('admin.user_management') }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <!-- Add User Button -->
          <div class="user-actions-bar">
            <button mat-raised-button color="primary" (click)="showCreateForm = !showCreateForm">
              <mat-icon>person_add</mat-icon>
              {{ i18n.t('admin.create_user') }}
            </button>
          </div>

          <!-- Create User Form -->
          <div class="create-user-form" *ngIf="showCreateForm">
            <h4>{{ i18n.t('admin.create_user') }}</h4>
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field">
                <mat-label>{{ i18n.t('admin.username') }}</mat-label>
                <input matInput [(ngModel)]="newUser.username">
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field">
                <mat-label>{{ i18n.t('admin.display_name') }}</mat-label>
                <input matInput [(ngModel)]="newUser.display_name">
              </mat-form-field>
            </div>
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field">
                <mat-label>{{ i18n.t('admin.email') }}</mat-label>
                <input matInput type="email" [(ngModel)]="newUser.email">
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field">
                <mat-label>{{ i18n.t('admin.password') }}</mat-label>
                <input matInput type="password" [(ngModel)]="newUser.password">
              </mat-form-field>
            </div>
            <div class="form-row form-row-actions">
              <mat-slide-toggle [(ngModel)]="newUser.is_admin" color="primary">
                Admin
              </mat-slide-toggle>
              <div class="form-buttons">
                <button mat-button (click)="showCreateForm = false">{{ i18n.t('common.cancel') }}</button>
                <button mat-raised-button color="primary" (click)="createUser()" [disabled]="creatingUser">
                  {{ i18n.t('admin.create') }}
                </button>
              </div>
            </div>
          </div>

          <!-- User List -->
          <div class="user-list">
            <div *ngFor="let u of users" class="user-row">
              <div class="user-avatar" [class.admin]="u.is_admin">{{ u.display_name?.charAt(0)?.toUpperCase() }}</div>
              <div class="user-info">
                <span class="user-name">
                  {{ u.display_name }}
                  <span class="admin-badge" *ngIf="u.is_admin">Admin</span>
                </span>
                <span class="user-meta">{{'@' + u.username}} &middot; {{ u.email }} &middot; {{ u.auth_source }}</span>
              </div>
              <div class="user-actions">
                <button mat-icon-button [matTooltip]="i18n.t('admin.edit_user')" (click)="startEdit(u)" class="action-btn">
                  <mat-icon>edit</mat-icon>
                </button>
                <button mat-icon-button [matTooltip]="i18n.t('admin.reset_password')" (click)="startResetPassword(u)" class="action-btn">
                  <mat-icon>lock_reset</mat-icon>
                </button>
                <button mat-icon-button [matTooltip]="i18n.t('admin.delete_user')" (click)="deleteUser(u)" class="action-btn delete-btn">
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Edit User Dialog (inline) -->
      <div class="modal-overlay" *ngIf="editingUser" (click)="editingUser = null">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <h3>{{ i18n.t('admin.edit_user') }}</h3>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ i18n.t('admin.display_name') }}</mat-label>
            <input matInput [(ngModel)]="editForm.display_name">
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ i18n.t('admin.email') }}</mat-label>
            <input matInput [(ngModel)]="editForm.email">
          </mat-form-field>
          <mat-slide-toggle [(ngModel)]="editForm.is_admin" color="primary">
            Admin
          </mat-slide-toggle>
          <div class="modal-actions">
            <button mat-button (click)="editingUser = null">{{ i18n.t('common.cancel') }}</button>
            <button mat-raised-button color="primary" (click)="saveEdit()">{{ i18n.t('admin.save') }}</button>
          </div>
        </div>
      </div>

      <!-- Reset Password Dialog (inline) -->
      <div class="modal-overlay" *ngIf="resetPasswordUser" (click)="resetPasswordUser = null">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <h3>{{ i18n.t('admin.reset_password') }}: {{ resetPasswordUser.display_name }}</h3>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ i18n.t('admin.new_password') }}</mat-label>
            <input matInput type="password" [(ngModel)]="resetPasswordValue">
          </mat-form-field>
          <div class="modal-actions">
            <button mat-button (click)="resetPasswordUser = null">{{ i18n.t('common.cancel') }}</button>
            <button mat-raised-button color="primary" (click)="confirmResetPassword()">{{ i18n.t('admin.reset') }}</button>
          </div>
        </div>
      </div>

      <!-- LDAP Config -->
      <mat-card class="admin-card">
        <mat-card-header>
          <mat-card-title>LDAP / Active Directory</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p class="config-info">{{ i18n.t('admin.ldap_info') }}</p>
          <div class="config-status" *ngIf="ldapConfig">
            <div class="config-row">
              <span class="config-label">Status</span>
              <span class="config-value" [class.active]="ldapConfig.ldap_enabled" [class.inactive]="!ldapConfig.ldap_enabled">
                {{ ldapConfig.ldap_enabled ? i18n.t('admin.enabled') : i18n.t('admin.disabled') }}
              </span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">Server</span>
              <span class="config-value">{{ ldapConfig.ldap_server }}:{{ ldapConfig.ldap_port }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">SSL</span>
              <span class="config-value">{{ ldapConfig.ldap_use_ssl ? i18n.t('admin.yes') : i18n.t('admin.no') }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">Base DN</span>
              <span class="config-value">{{ ldapConfig.ldap_base_dn }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">{{ i18n.t('admin.user_filter') }}</span>
              <span class="config-value">{{ ldapConfig.ldap_user_filter }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled && ldapConfig.ldap_group_dn">
              <span class="config-label">{{ i18n.t('admin.authorized_group') }}</span>
              <span class="config-value">{{ ldapConfig.ldap_group_dn }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled && ldapConfig.ldap_admin_group_dn">
              <span class="config-label">{{ i18n.t('admin.admin_group') }}</span>
              <span class="config-value">{{ ldapConfig.ldap_admin_group_dn }}</span>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .admin-page {
      padding: 24px 32px;
      max-width: 900px;
      overflow-y: auto;
      height: 100%;
      box-sizing: border-box;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 24px;
      color: #333;
    }
    .admin-card { margin-bottom: 24px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 16px;
      padding: 8px 0;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--primary); }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
    /* User actions bar */
    .user-actions-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }
    .user-actions-bar button mat-icon { margin-right: 4px; }
    /* Create user form */
    .create-user-form {
      background: #fafafa;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      border: 1px solid #e0e0e0;
    }
    .create-user-form h4 { margin: 0 0 12px 0; color: #333; }
    .form-row { display: flex; gap: 12px; }
    .form-field { flex: 1; }
    .form-row-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .form-buttons { display: flex; gap: 8px; }
    /* User list */
    .user-list { max-height: 500px; overflow-y: auto; }
    .user-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .user-avatar.admin { background: #e65100; }
    .user-info { flex: 1; min-width: 0; }
    .user-name { display: block; font-size: 14px; font-weight: 500; color: #333; }
    .user-meta { display: block; font-size: 11px; color: #999; }
    .admin-badge {
      display: inline-block;
      background: #e65100;
      color: white;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .user-actions { display: flex; gap: 0; flex-shrink: 0; }
    .action-btn { color: #666 !important; }
    .action-btn:hover { color: #333 !important; }
    .delete-btn { color: #999 !important; }
    .delete-btn:hover { color: #d32f2f !important; }
    /* Modal overlay */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      min-width: 360px;
      max-width: 440px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .modal-card h3 { margin: 0 0 16px 0; color: #333; }
    .full-width { width: 100%; }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
    /* Config */
    .config-info { color: #666; font-size: 13px; margin-bottom: 16px; }
    .config-status { border-top: 1px solid #eee; padding-top: 12px; }
    .config-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .config-label { font-weight: 500; color: #333; font-size: 13px; }
    .config-value { color: #666; font-size: 13px; }
    .config-value.active { color: #4caf50; font-weight: 600; }
    .config-value.inactive { color: #f44336; }
  `],
})
export class AdminPageComponent implements OnInit {
  stats: any = null;
  ldapConfig: any = null;
  users: any[] = [];

  // Create user
  showCreateForm = false;
  creatingUser = false;
  newUser = { username: '', email: '', password: '', display_name: '', is_admin: false };

  // Edit user
  editingUser: any = null;
  editForm = { display_name: '', email: '', is_admin: false };

  // Reset password
  resetPasswordUser: any = null;
  resetPasswordValue = '';

  constructor(
    private apiService: ApiService,
    private snackBar: MatSnackBar,
    public i18n: I18nService,
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.apiService.getAdminStats().subscribe((s) => (this.stats = s));
    this.apiService.getAdminLdapConfig().subscribe((c) => (this.ldapConfig = c));
    this.apiService.adminGetUsers().subscribe((u) => (this.users = u));
  }

  createUser(): void {
    if (!this.newUser.username || !this.newUser.email || !this.newUser.password || !this.newUser.display_name) {
      this.snackBar.open(this.i18n.t('admin.fill_all_fields'), this.i18n.t('common.ok'), { duration: 3000 });
      return;
    }
    this.creatingUser = true;
    this.apiService.adminCreateUser(this.newUser).subscribe({
      next: () => {
        this.snackBar.open(this.i18n.t('admin.user_created'), this.i18n.t('common.ok'), { duration: 3000 });
        this.showCreateForm = false;
        this.newUser = { username: '', email: '', password: '', display_name: '', is_admin: false };
        this.creatingUser = false;
        this.loadData();
      },
      error: (err) => {
        this.creatingUser = false;
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  startEdit(user: any): void {
    this.editingUser = user;
    this.editForm = {
      display_name: user.display_name,
      email: user.email,
      is_admin: user.is_admin,
    };
  }

  saveEdit(): void {
    if (!this.editingUser) return;
    this.apiService.adminUpdateUser(this.editingUser.id, this.editForm).subscribe({
      next: (updated) => {
        Object.assign(this.editingUser, updated);
        this.editingUser = null;
        this.snackBar.open(this.i18n.t('admin.user_updated'), this.i18n.t('common.ok'), { duration: 3000 });
        this.loadData();
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  deleteUser(user: any): void {
    if (!confirm(`${this.i18n.t('admin.confirm_delete')} "${user.display_name}"?`)) return;
    this.apiService.adminDeleteUser(user.id).subscribe({
      next: () => {
        this.users = this.users.filter((u) => u.id !== user.id);
        this.snackBar.open(this.i18n.t('admin.user_deleted'), this.i18n.t('common.ok'), { duration: 3000 });
        this.loadData();
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }

  startResetPassword(user: any): void {
    this.resetPasswordUser = user;
    this.resetPasswordValue = '';
  }

  confirmResetPassword(): void {
    if (!this.resetPasswordUser || !this.resetPasswordValue) return;
    this.apiService.adminResetPassword(this.resetPasswordUser.id, this.resetPasswordValue).subscribe({
      next: () => {
        this.snackBar.open(this.i18n.t('admin.password_reset'), this.i18n.t('common.ok'), { duration: 3000 });
        this.resetPasswordUser = null;
        this.resetPasswordValue = '';
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail || this.i18n.t('common.error'), this.i18n.t('common.ok'), { duration: 3000 });
      },
    });
  }
}
