import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '@env/environment';

export type UserStatus = 'online' | 'busy' | 'away' | 'dnd' | 'offline';

export const STATUS_LABELS: Record<UserStatus, string> = {
  online: 'Verfuegbar',
  busy: 'Beschaeftigt',
  away: 'Abwesend',
  dnd: 'Nicht stoeren',
  offline: 'Offline',
};

export const STATUS_ICONS: Record<UserStatus, string> = {
  online: 'check_circle',
  busy: 'do_not_disturb_on',
  away: 'schedule',
  dnd: 'remove_circle',
  offline: 'circle',
};

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_path: string | null;
  status: UserStatus;
  status_message: string | null;
  is_admin: boolean;
  auth_source: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    const stored = localStorage.getItem('current_user');
    if (stored) {
      this.currentUserSubject.next(JSON.parse(stored));
    }
  }

  register(data: { username: string; email: string; password: string; display_name: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/register`, data).pipe(
      tap((res) => this.handleAuth(res))
    );
  }

  login(username: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/login`, { username, password }).pipe(
      tap((res) => this.handleAuth(res))
    );
  }

  logout(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('current_user');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('access_token');
  }

  getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  updateLocalUser(updates: Partial<User>): void {
    const current = this.currentUserSubject.value;
    if (current) {
      const updated = { ...current, ...updates };
      localStorage.setItem('current_user', JSON.stringify(updated));
      this.currentUserSubject.next(updated);
    }
  }

  private handleAuth(res: AuthResponse): void {
    localStorage.setItem('access_token', res.access_token);
    localStorage.setItem('current_user', JSON.stringify(res.user));
    this.currentUserSubject.next(res.user);
  }
}
