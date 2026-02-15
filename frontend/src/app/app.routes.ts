import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/components/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./features/auth/components/register/register.component').then(
        (m) => m.RegisterComponent
      ),
  },
  {
    path: 'invite/:token',
    loadComponent: () =>
      import('./features/invite/components/invite-accept/invite-accept.component').then(
        (m) => m.InviteAcceptComponent
      ),
  },
  {
    path: 'meeting/guest/:token',
    loadComponent: () =>
      import('./features/guest/components/guest-join/guest-join.component').then(
        (m) => m.GuestJoinComponent
      ),
  },
  {
    path: '',
    loadComponent: () =>
      import('./features/layout/layout.component').then(
        (m) => m.LayoutComponent
      ),
    canActivate: [authGuard],
    children: [
      {
        path: 'feed',
        loadComponent: () =>
          import('./features/feed/components/feed/feed.component').then(
            (m) => m.FeedComponent
          ),
      },
      {
        path: 'teams',
        loadComponent: () =>
          import('./features/teams/components/team-list/team-list.component').then(
            (m) => m.TeamListComponent
          ),
      },
      {
        path: 'teams/chat/:channelId',
        loadComponent: () =>
          import('./features/chat/components/chat-room/chat-room.component').then(
            (m) => m.ChatRoomComponent
          ),
      },
      {
        path: 'teams/:teamId',
        loadComponent: () =>
          import('./features/teams/components/team-detail/team-detail.component').then(
            (m) => m.TeamDetailComponent
          ),
      },
      {
        path: 'chat',
        loadComponent: () =>
          import('./features/chat/components/chat-list/chat-list.component').then(
            (m) => m.ChatListComponent
          ),
      },
      {
        path: 'chat/:channelId',
        loadComponent: () =>
          import('./features/chat/components/chat-room/chat-room.component').then(
            (m) => m.ChatRoomComponent
          ),
      },
      {
        path: 'video/:channelId',
        loadComponent: () =>
          import('./features/video/components/video-room/video-room.component').then(
            (m) => m.VideoRoomComponent
          ),
      },
      {
        path: 'calendar',
        loadComponent: () =>
          import('./features/calendar/components/calendar-view/calendar-view.component').then(
            (m) => m.CalendarViewComponent
          ),
      },
      {
        path: 'calendar/google/callback',
        loadComponent: () =>
          import('./features/calendar/components/calendar-view/calendar-view.component').then(
            (m) => m.CalendarViewComponent
          ),
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/components/admin-page/admin-page.component').then(
            (m) => m.AdminPageComponent
          ),
      },
      { path: 'search', redirectTo: 'feed', pathMatch: 'full' },
      { path: '', redirectTo: 'feed', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
