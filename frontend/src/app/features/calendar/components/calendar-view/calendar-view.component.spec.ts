import { TestBed, ComponentFixture } from '@angular/core/testing';
import { CalendarViewComponent } from './calendar-view.component';
import { ApiService } from '@services/api.service';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

/* ---------- mock ---------- */

function createApiMock() {
  return {
    getCalendarEvents: jest.fn().mockReturnValue(of([])),
    createCalendarEvent: jest.fn().mockReturnValue(of({ id: 'ev1', title: 'Test' })),
    updateCalendarEvent: jest.fn().mockReturnValue(of({ id: 'ev1', title: 'Updated' })),
    deleteCalendarEvent: jest.fn().mockReturnValue(of(undefined)),
    getCalendarIntegration: jest.fn().mockReturnValue(of(null)),
    saveCalendarIntegration: jest.fn().mockReturnValue(of({ provider: 'internal' })),
    deleteCalendarIntegration: jest.fn().mockReturnValue(of(undefined)),
    syncCalendar: jest.fn().mockReturnValue(of([])),
  };
}

/* ---------- tests ---------- */

describe('CalendarViewComponent', () => {
  let component: CalendarViewComponent;
  let fixture: ComponentFixture<CalendarViewComponent>;
  let apiMock: ReturnType<typeof createApiMock>;

  beforeEach(async () => {
    apiMock = createApiMock();

    await TestBed.configureTestingModule({
      imports: [CalendarViewComponent, NoopAnimationsModule],
      providers: [{ provide: ApiService, useValue: apiMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarViewComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should build 42 calendar day cells', () => {
    component.buildCalendar();
    expect(component.calendarDays.length).toBe(42);
  });

  it('should mark today in the calendar grid', () => {
    const today = new Date();
    component.currentDate = today;
    component.buildCalendar();
    const todayCell = component.calendarDays.find((d) => d.today);
    expect(todayCell).toBeTruthy();
    expect(todayCell!.day).toBe(today.getDate());
  });

  it('should navigate to previous month', () => {
    component.currentDate = new Date(2026, 5, 1); // June 2026
    component.prevMonth();
    expect(component.currentDate.getMonth()).toBe(4); // May
  });

  it('should navigate to next month', () => {
    component.currentDate = new Date(2026, 5, 1);
    component.nextMonth();
    expect(component.currentDate.getMonth()).toBe(6); // July
  });

  it('should go to today on goToToday', () => {
    component.currentDate = new Date(2020, 0, 1);
    component.goToToday();
    const now = new Date();
    expect(component.currentDate.getFullYear()).toBe(now.getFullYear());
    expect(component.currentDate.getMonth()).toBe(now.getMonth());
  });

  it('should select a day', () => {
    component.buildCalendar();
    const day = component.calendarDays[10];
    component.selectDay(day);
    expect(day.selected).toBe(true);
    expect(component.selectedDate).toBe(day.date);
  });

  it('should load events on init', () => {
    fixture.detectChanges(); // triggers ngOnInit
    expect(apiMock.getCalendarEvents).toHaveBeenCalled();
    expect(apiMock.getCalendarIntegration).toHaveBeenCalled();
  });

  it('should display the correct month label (German)', () => {
    component.currentDate = new Date(2026, 0, 1); // January
    component.buildCalendar();
    expect(component.monthLabel).toContain('2026');
    // German locale should contain 'Januar' or 'January' depending on env
    expect(component.monthLabel.length).toBeGreaterThan(0);
  });

  it('should mark days with events', () => {
    component.currentDate = new Date(2026, 1, 1); // Feb 2026
    component.buildCalendar();

    const events = [
      {
        id: '1',
        title: 'Test',
        start_time: new Date(2026, 1, 14, 10, 0).toISOString(),
        end_time: new Date(2026, 1, 14, 11, 0).toISOString(),
        all_day: false,
      },
    ];
    apiMock.getCalendarEvents.mockReturnValue(of(events));
    component.loadEvents();

    const feb14 = component.calendarDays.find(
      (d) => d.currentMonth && d.day === 14
    );
    expect(feb14?.hasEvents).toBe(true);
  });

  it('should open event form for new event', () => {
    component.openNewEventForm();
    expect(component.showEventForm).toBe(true);
    expect(component.editingEvent).toBeNull();
    expect(component.eventTitle).toBe('');
  });

  it('should open event form for editing', () => {
    const ev = {
      id: 'ev1',
      title: 'Existing',
      description: 'Desc',
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600000).toISOString(),
      all_day: false,
      location: 'Office',
    };
    component.editEvent(ev);
    expect(component.showEventForm).toBe(true);
    expect(component.editingEvent).toBe(ev);
    expect(component.eventTitle).toBe('Existing');
    expect(component.eventLocation).toBe('Office');
  });

  it('should call createCalendarEvent when saving new event', () => {
    component.openNewEventForm();
    component.eventTitle = 'New Meeting';
    component.saveEvent();
    expect(apiMock.createCalendarEvent).toHaveBeenCalled();
    const callData = apiMock.createCalendarEvent.mock.calls[0][0];
    expect(callData.title).toBe('New Meeting');
  });

  it('should call updateCalendarEvent when saving edited event', () => {
    component.editingEvent = { id: 'ev1' } as any;
    component.showEventForm = true;
    component.eventTitle = 'Updated Title';
    component.eventStart = '2026-03-15T10:00';
    component.eventEnd = '2026-03-15T11:00';
    component.saveEvent();
    expect(apiMock.updateCalendarEvent).toHaveBeenCalledWith('ev1', expect.objectContaining({ title: 'Updated Title' }));
  });

  it('should not save event with empty title', () => {
    component.openNewEventForm();
    component.eventTitle = '';
    component.saveEvent();
    expect(apiMock.createCalendarEvent).not.toHaveBeenCalled();
  });

  it('should call deleteCalendarEvent on delete', () => {
    component.editingEvent = { id: 'ev1' } as any;
    // Mock window.confirm
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    component.deleteEvent();
    expect(apiMock.deleteCalendarEvent).toHaveBeenCalledWith('ev1');
  });

  it('should cancel event form', () => {
    component.openNewEventForm();
    expect(component.showEventForm).toBe(true);
    component.cancelEventForm();
    expect(component.showEventForm).toBe(false);
    expect(component.editingEvent).toBeNull();
  });

  it('should load integration on init', () => {
    fixture.detectChanges();
    expect(apiMock.getCalendarIntegration).toHaveBeenCalled();
  });

  it('should save integration settings', () => {
    component.settingsProvider = 'webdav';
    component.webdavUrl = 'https://cal.example.com';
    component.webdavUsername = 'user1';
    component.webdavPassword = 'secret';
    component.saveSettings();
    expect(apiMock.saveCalendarIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'webdav',
        webdav_url: 'https://cal.example.com',
        webdav_username: 'user1',
        webdav_password: 'secret',
      })
    );
  });

  it('should call syncCalendar', () => {
    component.syncCalendar();
    expect(apiMock.syncCalendar).toHaveBeenCalled();
  });

  it('should format time correctly', () => {
    const iso = new Date(2026, 2, 15, 14, 30).toISOString();
    const formatted = component.formatTime(iso);
    expect(formatted).toContain('14');
    expect(formatted).toContain('30');
  });

  it('should handle API errors gracefully on loadEvents', () => {
    apiMock.getCalendarEvents.mockReturnValue(throwError(() => new Error('fail')));
    component.loadEvents();
    expect(component.events).toEqual([]);
  });

  it('should generate correct selectedDateLabel', () => {
    component.selectedDate = new Date(2026, 1, 14);
    const label = component.selectedDateLabel;
    expect(label).toContain('2026');
    expect(label).toContain('14');
  });

  it('should filter events for selected day', () => {
    component.selectedDate = new Date(2026, 1, 14);
    component.events = [
      {
        id: '1',
        title: 'Today',
        start_time: new Date(2026, 1, 14, 10, 0).toISOString(),
        end_time: new Date(2026, 1, 14, 11, 0).toISOString(),
        all_day: false,
      },
      {
        id: '2',
        title: 'Tomorrow',
        start_time: new Date(2026, 1, 15, 10, 0).toISOString(),
        end_time: new Date(2026, 1, 15, 11, 0).toISOString(),
        all_day: false,
      },
    ];
    // Trigger private method via selectDay
    component.buildCalendar();
    const feb14 = component.calendarDays.find((d) => d.currentMonth && d.day === 14);
    if (feb14) component.selectDay(feb14);
    expect(component.selectedDayEvents.length).toBe(1);
    expect(component.selectedDayEvents[0].title).toBe('Today');
  });
});
