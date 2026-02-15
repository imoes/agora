import { Component, OnInit, OnDestroy, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ApiService } from '@services/api.service';

interface CalendarDay {
  date: Date;
  day: number;
  currentMonth: boolean;
  today: boolean;
  selected: boolean;
  hasEvents: boolean;
}

interface EventAttendee {
  id: string;
  email: string;
  display_name?: string;
  status: string;
  is_external: boolean;
}

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location?: string;
  channel_id?: string;
  attendees?: EventAttendee[];
}

@Component({
  selector: 'app-calendar-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatIconModule, MatButtonModule, MatTooltipModule, MatMenuModule, MatDividerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="calendar-page">
      <!-- Header -->
      <div class="cal-header">
        <h2>Kalender</h2>
        <div class="cal-header-actions">
          <button mat-icon-button [matTooltip]="syncing ? 'Synchronisiere...' : 'Synchronisieren'" (click)="syncCalendar()" *ngIf="integration?.provider && integration.provider !== 'internal'" [disabled]="syncing">
            <mat-icon [class.spinning]="syncing">sync</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Einstellungen" (click)="showSettings = !showSettings">
            <mat-icon>settings</mat-icon>
          </button>
        </div>
      </div>

      <!-- Settings Panel -->
      <div class="settings-panel" *ngIf="showSettings">
        <h3>Kalender-Integration</h3>
        <div class="provider-select">
          <label>Anbieter:</label>
          <select [(ngModel)]="settingsProvider" (change)="onProviderChange()">
            <option value="internal">Intern</option>
            <option value="webdav">WebDAV / CalDAV</option>
            <option value="google">Google Calendar</option>
            <option value="outlook">Outlook / Microsoft 365</option>
          </select>
        </div>

        <!-- WebDAV Settings -->
        <div *ngIf="settingsProvider === 'webdav'" class="provider-fields">
          <div class="field">
            <label>CalDAV-URL:</label>
            <input type="url" [(ngModel)]="webdavUrl" placeholder="https://calendar.example.com/dav/">
          </div>
          <div class="field">
            <label>Benutzername:</label>
            <input type="text" [(ngModel)]="webdavUsername">
          </div>
          <div class="field">
            <label>Passwort:</label>
            <input type="password" [(ngModel)]="webdavPassword">
          </div>
        </div>

        <!-- Google Settings -->
        <div *ngIf="settingsProvider === 'google'" class="provider-fields">
          <div *ngIf="googleConnected" class="field">
            <label>Verbunden als:</label>
            <span>{{ googleEmail || 'Google-Konto' }}</span>
            <button mat-button color="warn" (click)="disconnectGoogle()">Trennen</button>
          </div>
          <div *ngIf="!googleConnected" class="field">
            <button mat-raised-button color="primary" (click)="connectGoogle()">
              <mat-icon>login</mat-icon> Mit Google verbinden
            </button>
          </div>
          <span class="hint">Verbindet deinen Google Kalender via OAuth 2.0</span>
        </div>

        <!-- Outlook / Exchange Settings -->
        <div *ngIf="settingsProvider === 'outlook'" class="provider-fields">
          <div class="field">
            <label>Exchange-Server-URL:</label>
            <input type="url" [(ngModel)]="outlookServerUrl" placeholder="https://mail.example.com">
          </div>
          <div class="field">
            <label>Benutzername:</label>
            <input type="text" [(ngModel)]="outlookUsername" placeholder="DOMAIN\\benutzer oder email">
          </div>
          <div class="field">
            <label>Passwort:</label>
            <input type="password" [(ngModel)]="outlookPassword">
          </div>
        </div>

        <div class="settings-actions">
          <button class="btn btn-primary" (click)="saveSettings()">Speichern</button>
          <button class="btn btn-secondary" (click)="showSettings = false">Abbrechen</button>
        </div>
      </div>

      <!-- Mini Calendar -->
      <div class="mini-calendar">
        <div class="month-nav">
          <button mat-icon-button (click)="prevMonth()">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="month-label">{{ monthLabel }}</span>
          <button mat-icon-button (click)="nextMonth()">
            <mat-icon>chevron_right</mat-icon>
          </button>
          <button class="today-btn" (click)="goToToday()">Heute</button>
        </div>
        <div class="weekday-headers">
          <span *ngFor="let d of weekdays">{{ d }}</span>
        </div>
        <div class="days-grid">
          <div *ngFor="let day of calendarDays"
               class="day-cell"
               [class.other-month]="!day.currentMonth"
               [class.today]="day.today"
               [class.selected]="day.selected"
               [class.has-events]="day.hasEvents"
               (click)="selectDay(day)">
            {{ day.day }}
          </div>
        </div>
      </div>

      <!-- New Event Button -->
      <div class="new-event-section">
        <button class="btn btn-primary new-event-btn" (click)="openNewEventForm()">
          <mat-icon>add</mat-icon>
          Neuer Termin
        </button>
      </div>

      <!-- New/Edit Event Form -->
      <div class="event-form" *ngIf="showEventForm">
        <h3>{{ editingEvent ? 'Termin bearbeiten' : 'Neuer Termin' }}</h3>
        <div class="field">
          <label>Titel:</label>
          <input type="text" [(ngModel)]="eventTitle" placeholder="Termin-Name">
        </div>
        <div class="field">
          <label>Beschreibung:</label>
          <textarea [(ngModel)]="eventDescription" placeholder="Beschreibung (optional)" rows="2"></textarea>
        </div>
        <div class="field">
          <label>Beginn:</label>
          <input type="datetime-local" [(ngModel)]="eventStart">
        </div>
        <div class="field">
          <label>Ende:</label>
          <input type="datetime-local" [(ngModel)]="eventEnd">
        </div>
        <div class="field">
          <label>Ort:</label>
          <input type="text" [(ngModel)]="eventLocation" placeholder="Ort (optional)">
        </div>
        <div class="field checkbox-field">
          <label>
            <input type="checkbox" [(ngModel)]="eventAllDay">
            Ganztaegig
          </label>
        </div>
        <div class="field checkbox-field" *ngIf="!editingEvent">
          <label>
            <input type="checkbox" [(ngModel)]="eventCreateVideoCall">
            Video-Call erstellen
          </label>
          <span class="hint" *ngIf="eventCreateVideoCall">Ein Video-Call-Link wird automatisch im Ort eingetragen</span>
        </div>
        <div class="field">
          <label>Teilnehmer einladen:</label>
          <div class="attendee-input-row">
            <input type="email" [(ngModel)]="attendeeEmail"
                   placeholder="E-Mail-Adresse eingeben"
                   (keydown.enter)="addAttendee()">
            <button class="btn btn-small" (click)="addAttendee()" [disabled]="!attendeeEmail.trim()">
              <mat-icon>person_add</mat-icon>
            </button>
          </div>
          <div class="attendee-chips" *ngIf="eventAttendees.length > 0">
            <div class="attendee-chip" *ngFor="let email of eventAttendees; let i = index">
              <mat-icon class="chip-icon">person</mat-icon>
              <span>{{ email }}</span>
              <mat-icon class="chip-remove" (click)="removeAttendee(i)">close</mat-icon>
            </div>
          </div>
          <span class="hint" *ngIf="eventAttendees.length > 0">
            Externe Teilnehmer koennen dem Termin ohne Account beitreten
          </span>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" (click)="saveEvent()">Speichern</button>
          <button class="btn btn-secondary" (click)="cancelEventForm()">Abbrechen</button>
          <button *ngIf="editingEvent" class="btn btn-danger" (click)="deleteEvent()">Loeschen</button>
        </div>
      </div>

      <!-- Events List for Selected Day -->
      <div class="events-section">
        <h3 class="events-title">
          {{ selectedDateLabel }}
        </h3>
        <div *ngIf="selectedDayEvents.length === 0" class="no-events">
          Keine Termine
        </div>
        <div *ngFor="let ev of selectedDayEvents" class="event-card" (click)="editEvent(ev)">
          <div class="event-time">
            <span *ngIf="!ev.all_day">{{ formatTime(ev.start_time) }} - {{ formatTime(ev.end_time) }}</span>
            <span *ngIf="ev.all_day">Ganztaegig</span>
          </div>
          <div class="event-title">{{ ev.title }}</div>
          <div class="event-location" *ngIf="ev.location">
            <mat-icon class="event-location-icon">{{ isVideoLink(ev.location) ? 'videocam' : 'place' }}</mat-icon>
            <a *ngIf="isVideoLink(ev.location)" [routerLink]="getVideoLink(ev.location)" class="video-link">Video-Call beitreten</a>
            <span *ngIf="!isVideoLink(ev.location)">{{ ev.location }}</span>
          </div>
          <div class="event-attendees" *ngIf="ev.attendees && ev.attendees.length > 0">
            <mat-icon class="event-location-icon">group</mat-icon>
            <span>{{ ev.attendees.length }} Teilnehmer</span>
            <span class="attendee-names">{{ formatAttendees(ev.attendees) }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .calendar-page {
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
      height: 100%;
      overflow-y: auto;
    }
    .cal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .cal-header h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #333;
    }
    .cal-header-actions {
      display: flex;
      gap: 4px;
    }

    /* Settings */
    .settings-panel {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .settings-panel h3 {
      margin: 0 0 12px;
      font-size: 15px;
      font-weight: 600;
    }
    .provider-select {
      margin-bottom: 12px;
    }
    .provider-select label {
      display: block;
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
    }
    .provider-select select {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 13px;
      background: white;
    }
    .provider-fields {
      margin-top: 8px;
    }
    .field {
      margin-bottom: 10px;
    }
    .field label {
      display: block;
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
    }
    .field input, .field textarea, .field select {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 13px;
      box-sizing: border-box;
      font-family: inherit;
    }
    .field textarea {
      resize: vertical;
    }
    .checkbox-field label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #333;
      cursor: pointer;
    }
    .checkbox-field input[type="checkbox"] {
      width: auto;
    }
    .settings-actions, .form-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover {
      background: var(--primary-dark);
    }
    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }
    .btn-secondary:hover {
      background: #d0d0d0;
    }
    .btn-danger {
      background: #d32f2f;
      color: white;
    }
    .btn-danger:hover {
      background: #b71c1c;
    }
    .btn-small {
      padding: 4px 8px;
      border: none;
      border-radius: 4px;
      background: var(--primary);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
    }
    .btn-small mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .attendee-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .attendee-input-row input { flex: 1; }
    .attendee-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .attendee-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      background: #e8eaf6;
      border-radius: 16px;
      padding: 4px 8px 4px 6px;
      font-size: 12px;
      color: #333;
    }
    .chip-icon { font-size: 16px; width: 16px; height: 16px; color: var(--primary); }
    .chip-remove {
      font-size: 14px; width: 14px; height: 14px;
      cursor: pointer; color: #999;
    }
    .chip-remove:hover { color: #d32f2f; }
    .event-attendees {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }
    .attendee-names {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }

    /* Mini Calendar */
    .mini-calendar {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .month-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .month-label {
      font-size: 15px;
      font-weight: 600;
      min-width: 150px;
      text-align: center;
      color: #333;
    }
    .today-btn {
      margin-left: auto;
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: white;
      font-size: 12px;
      cursor: pointer;
      color: var(--primary);
      font-family: inherit;
    }
    .today-btn:hover {
      background: var(--hover);
    }
    .weekday-headers {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      text-align: center;
      font-size: 11px;
      color: #999;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .days-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .day-cell {
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      cursor: pointer;
      border-radius: 50%;
      position: relative;
      color: #333;
    }
    .day-cell:hover {
      background: var(--hover);
    }
    .day-cell.other-month {
      color: #ccc;
    }
    .day-cell.today {
      background: var(--primary);
      color: white;
      font-weight: 700;
    }
    .day-cell.today:hover {
      background: var(--primary-dark);
    }
    .day-cell.selected {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
    .day-cell.has-events::after {
      content: '';
      position: absolute;
      bottom: 2px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent);
    }
    .day-cell.today.has-events::after {
      background: white;
    }

    /* New event button */
    .new-event-section {
      margin-bottom: 16px;
    }
    .new-event-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px;
    }
    .new-event-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* Event Form */
    .event-form {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .event-form h3 {
      margin: 0 0 12px;
      font-size: 15px;
      font-weight: 600;
    }

    /* Events List */
    .events-section {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .events-title {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: #333;
    }
    .no-events {
      text-align: center;
      color: #999;
      font-size: 13px;
      padding: 16px 0;
    }
    .event-card {
      padding: 10px 12px;
      border-left: 3px solid var(--primary);
      background: #f9f9ff;
      border-radius: 0 6px 6px 0;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .event-card:hover {
      background: #f0f0ff;
    }
    .event-time {
      font-size: 11px;
      color: var(--primary);
      font-weight: 600;
      margin-bottom: 2px;
    }
    .event-title {
      font-size: 13px;
      font-weight: 500;
      color: #333;
    }
    .event-location {
      font-size: 11px;
      color: #999;
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 2px;
    }
    .event-location-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .video-link {
      color: var(--primary);
      text-decoration: none;
      font-weight: 500;
    }
    .video-link:hover {
      text-decoration: underline;
    }
    .hint {
      display: block;
      font-size: 11px;
      color: #999;
      margin-top: 2px;
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spinning { animation: spin 1s linear infinite; }
  `],
})
export class CalendarViewComponent implements OnInit, OnDestroy {
  // Calendar state
  currentDate = new Date();
  selectedDate = new Date();
  calendarDays: CalendarDay[] = [];
  weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  monthLabel = '';

  // Events
  events: CalendarEvent[] = [];
  selectedDayEvents: CalendarEvent[] = [];

  // Event form
  showEventForm = false;
  editingEvent: CalendarEvent | null = null;
  eventTitle = '';
  eventDescription = '';
  eventStart = '';
  eventEnd = '';
  eventLocation = '';
  eventAllDay = false;
  eventCreateVideoCall = false;
  eventAttendees: string[] = [];
  attendeeEmail = '';

  // Settings
  showSettings = false;
  integration: any = null;
  settingsProvider = 'internal';
  webdavUrl = '';
  webdavUsername = '';
  webdavPassword = '';
  googleEmail = '';
  googleAppPassword = '';
  googleConnected = false;
  outlookServerUrl = '';
  outlookUsername = '';
  outlookPassword = '';

  private subscriptions: Subscription[] = [];

  syncing = false;

  constructor(
    private apiService: ApiService,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute,
    private router: Router,
    private elementRef: ElementRef,
  ) {}

  ngOnInit(): void {
    this.buildCalendar();
    this.loadEvents();
    this.loadIntegration();
    this.handleGoogleCallback();
  }

  private handleGoogleCallback(): void {
    const params = new URLSearchParams(window.location.search);

    // Case 1: Backend GET callback already exchanged the code and redirected here
    if (params.get('google_connected') === 'true') {
      this.router.navigate(['/calendar'], { replaceUrl: true });
      this.snackBar.open('Google-Konto verbunden', 'OK', { duration: 3000 });
      this.loadIntegration();
      return;
    }

    // Case 2: Legacy frontend-based callback with code param
    const code = params.get('code');
    if (!code) return;

    this.router.navigate(['/calendar'], { replaceUrl: true });

    this.apiService.sendGoogleCallback(code).subscribe({
      next: (res) => {
        this.snackBar.open(
          `Google-Konto verbunden: ${res.google_email || 'OK'}`,
          'OK', { duration: 3000 },
        );
        this.loadIntegration();
      },
      error: (err) => {
        const detail = err.error?.detail || 'Google-Verbindung fehlgeschlagen';
        this.snackBar.open(detail, 'OK', { duration: 6000 });
      },
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  get selectedDateLabel(): string {
    return this.selectedDate.toLocaleDateString('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  // ---------- Calendar Navigation ----------

  prevMonth(): void {
    this.currentDate = new Date(
      this.currentDate.getFullYear(),
      this.currentDate.getMonth() - 1,
      1
    );
    this.buildCalendar();
    this.loadEvents();
  }

  nextMonth(): void {
    this.currentDate = new Date(
      this.currentDate.getFullYear(),
      this.currentDate.getMonth() + 1,
      1
    );
    this.buildCalendar();
    this.loadEvents();
  }

  goToToday(): void {
    this.currentDate = new Date();
    this.selectedDate = new Date();
    this.buildCalendar();
    this.loadEvents();
  }

  selectDay(day: CalendarDay): void {
    this.selectedDate = day.date;
    this.calendarDays.forEach((d) => (d.selected = false));
    day.selected = true;
    this.updateSelectedDayEvents();
  }

  // ---------- Calendar Grid ----------

  buildCalendar(): void {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    this.monthLabel = new Date(year, month).toLocaleDateString('de-DE', {
      month: 'long',
      year: 'numeric',
    });

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-based week (0=Mon..6=Sun)
    let startOffset = (firstDay.getDay() + 6) % 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    this.calendarDays = [];

    // Previous month days
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      this.calendarDays.push(this.createDay(d, false, today));
    }

    // Current month days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      this.calendarDays.push(this.createDay(date, true, today));
    }

    // Next month days (fill to 42 cells = 6 rows)
    const remaining = 42 - this.calendarDays.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      this.calendarDays.push(this.createDay(d, false, today));
    }
  }

  private createDay(date: Date, currentMonth: boolean, today: Date): CalendarDay {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return {
      date: d,
      day: d.getDate(),
      currentMonth,
      today: d.getTime() === today.getTime(),
      selected: d.getTime() === new Date(this.selectedDate).setHours(0, 0, 0, 0),
      hasEvents: false,
    };
  }

  // ---------- Events ----------

  loadEvents(): void {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    this.apiService.getCalendarEvents(start, end).subscribe({
      next: (events) => {
        this.events = events;
        this.markDaysWithEvents();
        this.updateSelectedDayEvents();
      },
      error: () => {
        this.events = [];
      },
    });
  }

  private markDaysWithEvents(): void {
    const eventDates = new Set<string>();
    for (const ev of this.events) {
      const start = new Date(ev.start_time);
      const end = new Date(ev.end_time);
      const d = new Date(start);
      d.setHours(0, 0, 0, 0);
      while (d <= end) {
        eventDates.add(d.toDateString());
        d.setDate(d.getDate() + 1);
      }
    }
    for (const day of this.calendarDays) {
      day.hasEvents = eventDates.has(day.date.toDateString());
    }
  }

  private updateSelectedDayEvents(): void {
    const selDate = new Date(this.selectedDate);
    selDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selDate);
    nextDay.setDate(nextDay.getDate() + 1);

    this.selectedDayEvents = this.events.filter((ev) => {
      const start = new Date(ev.start_time);
      const end = new Date(ev.end_time);
      return start < nextDay && end > selDate;
    }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  formatAttendees(attendees: EventAttendee[]): string {
    return attendees.map(a => a.display_name || a.email).join(', ');
  }

  // ---------- Event Form ----------

  openNewEventForm(): void {
    this.editingEvent = null;
    this.showEventForm = true;
    const sel = new Date(this.selectedDate);
    const now = new Date();
    sel.setHours(now.getHours() + 1, 0, 0, 0);
    const endTime = new Date(sel);
    endTime.setHours(endTime.getHours() + 1);
    this.eventTitle = '';
    this.eventDescription = '';
    this.eventStart = this.toLocalDatetime(sel);
    this.eventEnd = this.toLocalDatetime(endTime);
    this.eventLocation = '';
    this.eventAllDay = false;
    this.eventCreateVideoCall = false;
    this.eventAttendees = [];
    this.attendeeEmail = '';
    setTimeout(() => {
      const formEl = this.elementRef.nativeElement.querySelector('.event-form');
      if (formEl) {
        formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  addAttendee(): void {
    const email = this.attendeeEmail.trim().toLowerCase();
    if (email && email.includes('@') && !this.eventAttendees.includes(email)) {
      this.eventAttendees.push(email);
    }
    this.attendeeEmail = '';
  }

  removeAttendee(index: number): void {
    this.eventAttendees.splice(index, 1);
  }

  editEvent(ev: CalendarEvent): void {
    this.editingEvent = ev;
    this.showEventForm = true;
    this.eventTitle = ev.title;
    this.eventDescription = ev.description || '';
    this.eventStart = this.toLocalDatetime(new Date(ev.start_time));
    this.eventEnd = this.toLocalDatetime(new Date(ev.end_time));
    this.eventLocation = ev.location || '';
    this.eventAllDay = ev.all_day;
  }

  saveEvent(): void {
    if (!this.eventTitle.trim()) return;
    const data: any = {
      title: this.eventTitle.trim(),
      description: this.eventDescription.trim() || null,
      start_time: new Date(this.eventStart).toISOString(),
      end_time: new Date(this.eventEnd).toISOString(),
      all_day: this.eventAllDay,
      location: this.eventLocation.trim() || null,
      create_video_call: this.eventCreateVideoCall,
    };

    // Include attendees for new events
    if (!this.editingEvent && this.eventAttendees.length > 0) {
      data.attendees = this.eventAttendees.map((email: string) => ({ email }));
    }

    if (this.editingEvent) {
      this.apiService.updateCalendarEvent(this.editingEvent.id, data).subscribe({
        next: () => {
          this.showEventForm = false;
          this.editingEvent = null;
          this.loadEvents();
        },
      });
    } else {
      this.apiService.createCalendarEvent(data).subscribe({
        next: (created: any) => {
          this.showEventForm = false;
          if (data.attendees?.length > 0) {
            this.snackBar.open(
              `Termin erstellt, ${data.attendees.length} Einladung(en) werden versendet`,
              'OK', { duration: 4000 },
            );
          }
          this.loadEvents();
        },
      });
    }
  }

  deleteEvent(): void {
    if (!this.editingEvent) return;
    if (!confirm('Termin wirklich loeschen?')) return;
    this.apiService.deleteCalendarEvent(this.editingEvent.id).subscribe({
      next: () => {
        this.showEventForm = false;
        this.editingEvent = null;
        this.loadEvents();
      },
    });
  }

  cancelEventForm(): void {
    this.showEventForm = false;
    this.editingEvent = null;
    this.eventAttendees = [];
    this.attendeeEmail = '';
  }

  private toLocalDatetime(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- Integration / Settings ----------

  loadIntegration(): void {
    this.apiService.getCalendarIntegration().subscribe({
      next: (data) => {
        this.integration = data;
        if (data) {
          this.settingsProvider = data.provider || 'internal';
          this.webdavUrl = data.webdav_url || '';
          this.webdavUsername = data.webdav_username || '';
          this.googleEmail = data.google_email || '';
          this.googleConnected = data.google_connected || false;
          this.outlookServerUrl = data.outlook_server_url || '';
          this.outlookUsername = data.outlook_username || '';
        }
      },
      error: (err) => {
        const detail = err.error?.detail || 'Fehler beim Laden der Integration';
        this.snackBar.open(detail, 'OK', { duration: 5000 });
      },
    });
  }

  onProviderChange(): void {
    // Reset fields when switching provider
  }

  saveSettings(): void {
    const data: any = { provider: this.settingsProvider };
    if (this.settingsProvider === 'webdav') {
      data.webdav_url = this.webdavUrl;
      data.webdav_username = this.webdavUsername;
      if (this.webdavPassword) data.webdav_password = this.webdavPassword;
    } else if (this.settingsProvider === 'google') {
      // Google uses OAuth – no manual credentials needed
    } else if (this.settingsProvider === 'outlook') {
      data.outlook_server_url = this.outlookServerUrl || null;
      data.outlook_username = this.outlookUsername || null;
      if (this.outlookPassword) data.outlook_password = this.outlookPassword;
    }
    this.apiService.saveCalendarIntegration(data).subscribe({
      next: (integration) => {
        this.integration = integration;
        this.showSettings = false;
        this.snackBar.open('Einstellungen gespeichert', 'OK', { duration: 2000 });
      },
      error: (err) => {
        const detail = err.error?.detail || 'Fehler beim Speichern der Einstellungen';
        this.snackBar.open(detail, 'OK', { duration: 5000 });
      },
    });
  }

  isVideoLink(location: string): boolean {
    return location?.includes('/video/') ?? false;
  }

  getVideoLink(location: string): string {
    const match = location?.match(/\/video\/[a-f0-9-]+/);
    return match ? match[0] : '';
  }

  syncCalendar(): void {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    this.syncing = true;
    this.apiService.syncCalendar(start, end).subscribe({
      next: (events) => {
        this.syncing = false;
        const count = Array.isArray(events) ? events.length : 0;
        this.snackBar.open(
          count > 0 ? `${count} Termin(e) synchronisiert` : 'Keine neuen Termine gefunden',
          'OK', { duration: 3000 },
        );
        this.loadEvents();
      },
      error: (err) => {
        this.syncing = false;
        const detail = err.error?.detail || 'Synchronisierung fehlgeschlagen';
        this.snackBar.open(detail, 'OK', { duration: 6000 });
      },
    });
  }

  connectGoogle(): void {
    this.apiService.getGoogleAuthUrl().subscribe({
      next: (res) => {
        window.location.href = res.auth_url;
      },
      error: (err) => {
        const detail = err.error?.detail || 'Google OAuth nicht verfuegbar';
        this.snackBar.open(detail, 'OK', { duration: 5000 });
      },
    });
  }

  disconnectGoogle(): void {
    this.googleConnected = false;
    this.googleEmail = '';
    this.apiService.saveCalendarIntegration({ provider: 'internal' }).subscribe({
      next: () => {
        this.snackBar.open('Google-Konto getrennt', 'OK', { duration: 2000 });
        this.loadIntegration();
      },
    });
  }
}
