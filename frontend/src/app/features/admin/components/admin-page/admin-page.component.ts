import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ApiService } from '@services/api.service';

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatCardModule, MatDividerModule, MatSlideToggleModule],
  template: `
    <div class="admin-page">
      <h2><mat-icon>admin_panel_settings</mat-icon> Administration</h2>

      <!-- Stats -->
      <mat-card class="admin-card" *ngIf="stats">
        <mat-card-header>
          <mat-card-title>System-Statistiken</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-value">{{ stats.total_users }}</span>
              <span class="stat-label">Benutzer gesamt</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.online_users }}</span>
              <span class="stat-label">Online</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.local_users }}</span>
              <span class="stat-label">Lokale Benutzer</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.ldap_users }}</span>
              <span class="stat-label">LDAP Benutzer</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ stats.admin_users }}</span>
              <span class="stat-label">Admins</span>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- LDAP Config (read-only, configured via .env) -->
      <mat-card class="admin-card">
        <mat-card-header>
          <mat-card-title>LDAP / Active Directory</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p class="config-info">
            Die LDAP-Konfiguration erfolgt ueber die <code>.env</code>-Datei.
            Wenn LDAP aktiviert ist, wird die Registrierung deaktiviert und Benutzer
            werden bei der ersten Anmeldung automatisch angelegt.
          </p>

          <div class="config-status" *ngIf="ldapConfig">
            <div class="config-row">
              <span class="config-label">Status</span>
              <span class="config-value" [class.active]="ldapConfig.ldap_enabled" [class.inactive]="!ldapConfig.ldap_enabled">
                {{ ldapConfig.ldap_enabled ? 'Aktiviert' : 'Deaktiviert' }}
              </span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">Server</span>
              <span class="config-value">{{ ldapConfig.ldap_server }}:{{ ldapConfig.ldap_port }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">SSL</span>
              <span class="config-value">{{ ldapConfig.ldap_use_ssl ? 'Ja' : 'Nein' }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">Base DN</span>
              <span class="config-value">{{ ldapConfig.ldap_base_dn }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">Benutzer-Filter</span>
              <span class="config-value">{{ ldapConfig.ldap_user_filter }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled && ldapConfig.ldap_group_dn">
              <span class="config-label">Berechtigte Gruppe</span>
              <span class="config-value">{{ ldapConfig.ldap_group_dn }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled && ldapConfig.ldap_admin_group_dn">
              <span class="config-label">Admin-Gruppe</span>
              <span class="config-value">{{ ldapConfig.ldap_admin_group_dn }}</span>
            </div>
            <div class="config-row" *ngIf="ldapConfig.ldap_enabled">
              <span class="config-label">Registrierung</span>
              <span class="config-value inactive">Deaktiviert (LDAP aktiv)</span>
            </div>
          </div>

          <div class="env-example" *ngIf="!ldapConfig?.ldap_enabled">
            <p class="env-title">Beispiel <code>.env</code>-Konfiguration:</p>
            <pre class="env-block">LDAP_ENABLED=true
LDAP_SERVER=ldap.example.com
LDAP_PORT=389
LDAP_USE_SSL=false
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=secret
LDAP_BASE_DN=dc=example,dc=com
LDAP_USER_FILTER=(sAMAccountName={{'{'}}username{{'}'}})
LDAP_GROUP_DN=cn=agora-users,ou=groups,dc=example,dc=com
LDAP_ADMIN_GROUP_DN=cn=agora-admins,ou=groups,dc=example,dc=com</pre>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- User Management -->
      <mat-card class="admin-card">
        <mat-card-header>
          <mat-card-title>Benutzerverwaltung</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="user-list">
            <div *ngFor="let u of users" class="user-row">
              <div class="user-avatar">{{ u.display_name?.charAt(0)?.toUpperCase() }}</div>
              <div class="user-info">
                <span class="user-name">{{ u.display_name }}</span>
                <span class="user-meta">{{'@' + u.username}} &middot; {{ u.email }} &middot; {{ u.auth_source }}</span>
              </div>
              <mat-slide-toggle
                [checked]="u.is_admin"
                (change)="toggleAdmin(u)"
                color="primary">
                Admin
              </mat-slide-toggle>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .admin-page {
      padding: 24px 32px;
      max-width: 800px;
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
    .admin-card {
      margin-bottom: 24px;
    }
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
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--primary);
    }
    .stat-label {
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }
    .config-info {
      color: #666;
      font-size: 13px;
      margin-bottom: 16px;
    }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }
    .config-status {
      border-top: 1px solid #eee;
      padding-top: 12px;
    }
    .config-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .config-label {
      font-weight: 500;
      color: #333;
      font-size: 13px;
    }
    .config-value {
      color: #666;
      font-size: 13px;
    }
    .config-value.active { color: #4caf50; font-weight: 600; }
    .config-value.inactive { color: #f44336; }
    .env-example {
      margin-top: 16px;
      background: #fafafa;
      border-radius: 8px;
      padding: 16px;
    }
    .env-title {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: #666;
    }
    .env-block {
      background: #292929;
      color: #e0e0e0;
      padding: 16px;
      border-radius: 6px;
      font-size: 12px;
      overflow-x: auto;
      margin: 0;
    }
    .user-list {
      max-height: 400px;
      overflow-y: auto;
    }
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
    .user-info {
      flex: 1;
      min-width: 0;
    }
    .user-name {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #333;
    }
    .user-meta {
      display: block;
      font-size: 11px;
      color: #999;
    }
  `],
})
export class AdminPageComponent implements OnInit {
  stats: any = null;
  ldapConfig: any = null;
  users: any[] = [];

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.apiService.getAdminStats().subscribe((s) => (this.stats = s));
    this.apiService.getAdminLdapConfig().subscribe((c) => (this.ldapConfig = c));
    this.apiService.getUsers().subscribe((u) => (this.users = u));
  }

  toggleAdmin(user: any): void {
    const newVal = !user.is_admin;
    this.apiService.toggleUserAdmin(user.id, newVal).subscribe(() => {
      user.is_admin = newVal;
    });
  }
}
