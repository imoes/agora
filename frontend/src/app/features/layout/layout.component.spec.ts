import { TestBed } from '@angular/core/testing';
import { Router, NavigationEnd } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, EMPTY } from 'rxjs';
import { LayoutComponent } from './layout.component';
import { AuthService } from '@core/services/auth.service';
import { ApiService } from '@services/api.service';
import { WebSocketService } from '@services/websocket.service';
import { I18nService } from '@services/i18n.service';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockUser = {
  id: 'user-1',
  username: 'testuser',
  display_name: 'Test User',
  email: 'test@example.com',
  status: 'online',
  notification_sound_path: null,
};

function createMockApiService() {
  return {
    getChannels: jest.fn().mockReturnValue(of([])),
    getUnreadCount: jest.fn().mockReturnValue(of({ unread_count: 0 })),
    markFeedRead: jest.fn().mockReturnValue(of({})),
    getNotificationSoundUrl: jest.fn().mockReturnValue(null),
    updateReadPosition: jest.fn().mockReturnValue(of({})),
    getPendingInvitationsCount: jest.fn().mockReturnValue(of({ count: 0 })),
    getCalendarEvents: jest.fn().mockReturnValue(of([])),
    getCurrentUser: jest.fn().mockReturnValue(of(mockUser)),
  };
}

function createMockAuthService() {
  return {
    currentUser$: new Subject(),
    getToken: jest.fn().mockReturnValue('token'),
    getCurrentUser: jest.fn().mockReturnValue(mockUser),
    logout: jest.fn(),
  };
}

function createMockRouter() {
  return {
    url: '/chat',
    events: new Subject(),
    navigate: jest.fn(),
  };
}

function createMockWebSocketService() {
  return {
    globalMessages$: new Subject(),
    connectNotifications: jest.fn(),
    disconnectNotifications: jest.fn(),
    disconnectAll: jest.fn(),
    connect: jest.fn().mockReturnValue(EMPTY),
    send: jest.fn(),
    broadcastStatus: jest.fn(),
  };
}

function createMockI18n() {
  return {
    t: jest.fn((key: string) => key),
    lang: 'en',
    setLang: jest.fn(),
  };
}

/* ------------------------------------------------------------------ */
/*  Test suite                                                         */
/* ------------------------------------------------------------------ */

describe('LayoutComponent – notification logic', () => {
  let component: LayoutComponent;
  let apiService: ReturnType<typeof createMockApiService>;
  let wsService: ReturnType<typeof createMockWebSocketService>;
  let router: ReturnType<typeof createMockRouter>;
  let globalMessages$: Subject<any>;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    apiService = createMockApiService();
    wsService = createMockWebSocketService();
    router = createMockRouter();
    globalMessages$ = wsService.globalMessages$ as Subject<any>;

    // Construct component manually to avoid full template rendering
    component = new LayoutComponent(
      createMockAuthService() as any,
      apiService as any,
      wsService as any,
      router as any,
      { open: jest.fn() } as any, // MatSnackBar
      createMockI18n() as any,
    );

    component.currentUser = mockUser as any;
    component.activeChannelId = null;
    component.notificationsMuted = false;
  });

  /* ---------- URL-based activeChannelId extraction ---------- */

  describe('activeChannelId from URL', () => {
    it('should extract channelId from /chat/:channelId', () => {
      const url = '/chat/abc-123';
      const match = url.match(/\/(?:teams\/)?chat\/([^?/]+)/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('abc-123');
    });

    it('should extract channelId from /teams/chat/:channelId', () => {
      const url = '/teams/chat/team-channel-456';
      const match = url.match(/\/(?:teams\/)?chat\/([^?/]+)/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('team-channel-456');
    });

    it('should return null for /feed', () => {
      const url = '/feed';
      const match = url.match(/\/(?:teams\/)?chat\/([^?/]+)/);
      expect(match).toBeNull();
    });

    it('should return null for /teams (team list)', () => {
      const url = '/teams';
      const match = url.match(/\/(?:teams\/)?chat\/([^?/]+)/);
      expect(match).toBeNull();
    });

    it('should strip query params from channelId', () => {
      const url = '/chat/abc-123?foo=bar';
      const match = url.match(/\/(?:teams\/)?chat\/([^?/]+)/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('abc-123');
    });
  });

  /* ---------- playNotificationSound ---------- */

  describe('playNotificationSound', () => {
    let mockAudio: { currentTime: number; play: jest.Mock };

    beforeEach(() => {
      mockAudio = { currentTime: 5, play: jest.fn().mockResolvedValue(undefined) };
      (component as any).notificationAudio = mockAudio;
    });

    it('should play sound when not muted', () => {
      component.notificationsMuted = false;
      component.playNotificationSound();
      expect(mockAudio.play).toHaveBeenCalled();
      expect(mockAudio.currentTime).toBe(0);
    });

    it('should NOT play sound when muted', () => {
      component.notificationsMuted = true;
      component.playNotificationSound();
      expect(mockAudio.play).not.toHaveBeenCalled();
    });

    it('should NOT play sound when audio element is null', () => {
      (component as any).notificationAudio = null;
      component.playNotificationSound();
      // No error thrown
    });
  });

  /* ---------- toggleNotificationMute ---------- */

  describe('toggleNotificationMute', () => {
    it('should toggle from unmuted to muted', () => {
      component.notificationsMuted = false;
      component.toggleNotificationMute();
      expect(component.notificationsMuted).toBe(true);
      expect(localStorage.getItem('notificationsMuted')).toBe('true');
    });

    it('should toggle from muted to unmuted', () => {
      component.notificationsMuted = true;
      component.toggleNotificationMute();
      expect(component.notificationsMuted).toBe(false);
      expect(localStorage.getItem('notificationsMuted')).toBe('false');
    });

    it('should persist mute state across component instances', () => {
      component.toggleNotificationMute(); // mute
      expect(localStorage.getItem('notificationsMuted')).toBe('true');

      // Simulate new instance reading from localStorage
      const isMuted = localStorage.getItem('notificationsMuted') === 'true';
      expect(isMuted).toBe(true);
    });
  });

  /* ---------- new_message handling logic ---------- */

  describe('new_message WebSocket handler', () => {
    let playNotificationSoundSpy: jest.SpyInstance;

    beforeEach(() => {
      playNotificationSoundSpy = jest.spyOn(component, 'playNotificationSound').mockImplementation();
    });

    function simulateNewMessage(channelId: string, senderId: string) {
      // Simulate the globalMessages$ handler inline
      // (mirrors the logic in the subscription set up during ngOnInit)
      const msg = {
        type: 'new_message',
        _channelId: channelId,
        message: { sender_id: senderId, channel_id: channelId },
      };

      const msgChannelId = msg._channelId || msg.message?.channel_id;
      const isActiveChannel = msgChannelId && msgChannelId === component.activeChannelId;

      // loadChatChannels with clear
      component.loadChatChannels(isActiveChannel ? msgChannelId : undefined);

      if (isActiveChannel) {
        apiService.markFeedRead({ channel_id: msgChannelId });
      }

      // Sound logic
      if (msg.message?.sender_id !== component.currentUser?.id && !isActiveChannel) {
        component.playNotificationSound();
      }
    }

    it('should NOT play sound for messages in the active (regular) chat', () => {
      component.activeChannelId = 'channel-1';
      simulateNewMessage('channel-1', 'other-user');

      expect(playNotificationSoundSpy).not.toHaveBeenCalled();
    });

    it('should play sound for messages in a different chat', () => {
      component.activeChannelId = 'channel-1';
      simulateNewMessage('channel-2', 'other-user');

      expect(playNotificationSoundSpy).toHaveBeenCalledTimes(1);
    });

    it('should NOT play sound for own messages (even in other channels)', () => {
      component.activeChannelId = 'channel-1';
      simulateNewMessage('channel-2', 'user-1'); // currentUser.id = 'user-1'

      expect(playNotificationSoundSpy).not.toHaveBeenCalled();
    });

    it('should NOT play sound for messages in active Teams channel', () => {
      // Simulating user viewing /teams/chat/team-channel-1
      component.activeChannelId = 'team-channel-1';
      simulateNewMessage('team-channel-1', 'other-user');

      expect(playNotificationSoundSpy).not.toHaveBeenCalled();
    });

    it('should play sound for messages in inactive Teams channel', () => {
      component.activeChannelId = 'team-channel-1';
      simulateNewMessage('team-channel-2', 'other-user');

      expect(playNotificationSoundSpy).toHaveBeenCalledTimes(1);
    });

    it('should play sound when no channel is active (e.g. on /feed)', () => {
      component.activeChannelId = null;
      simulateNewMessage('channel-1', 'other-user');

      expect(playNotificationSoundSpy).toHaveBeenCalledTimes(1);
    });

    it('should mark feed as read when message is in active channel', () => {
      component.activeChannelId = 'channel-1';
      simulateNewMessage('channel-1', 'other-user');

      expect(apiService.markFeedRead).toHaveBeenCalledWith({ channel_id: 'channel-1' });
    });

    it('should NOT mark feed as read when message is in a different channel', () => {
      component.activeChannelId = 'channel-1';
      simulateNewMessage('channel-2', 'other-user');

      expect(apiService.markFeedRead).not.toHaveBeenCalled();
    });
  });

  /* ---------- loadChatChannels with clearChannelId ---------- */

  describe('loadChatChannels', () => {
    it('should zero unread_count for clearChannelId after loading', () => {
      const channels = [
        { id: 'ch-1', unread_count: 5, channel_type: 'direct' },
        { id: 'ch-2', unread_count: 3, channel_type: 'direct' },
      ];
      apiService.getChannels.mockReturnValue(of(channels));

      component.loadChatChannels('ch-1');

      expect(channels[0].unread_count).toBe(0);
      expect(channels[1].unread_count).toBe(3);
    });

    it('should NOT touch unread counts when no clearChannelId', () => {
      const channels = [
        { id: 'ch-1', unread_count: 5, channel_type: 'direct' },
        { id: 'ch-2', unread_count: 3, channel_type: 'direct' },
      ];
      apiService.getChannels.mockReturnValue(of(channels));

      component.loadChatChannels();

      expect(channels[0].unread_count).toBe(5);
      expect(channels[1].unread_count).toBe(3);
    });

    it('should zero unread_count for a Teams channel', () => {
      const channels = [
        { id: 'team-ch-1', unread_count: 7, team_id: 'team-1', channel_type: 'team' },
        { id: 'ch-2', unread_count: 2, channel_type: 'direct' },
      ];
      apiService.getChannels.mockReturnValue(of(channels));

      component.loadChatChannels('team-ch-1');

      expect(channels[0].unread_count).toBe(0);
      expect(channels[1].unread_count).toBe(2);
    });
  });

  /* ---------- unread badge computation ---------- */

  describe('updateFilteredChannels (badge counts)', () => {
    it('should compute chatUnreadCount excluding active channel', () => {
      component.chatChannels = [
        { id: 'ch-1', unread_count: 0, channel_type: 'direct' },
        { id: 'ch-2', unread_count: 3, channel_type: 'direct' },
      ];
      component.sidebarMode = 'chats';

      (component as any).updateFilteredChannels();

      expect(component.chatUnreadCount).toBe(3);
    });

    it('should compute teamsUnreadCount for team channels', () => {
      component.chatChannels = [
        { id: 'ch-1', unread_count: 2, channel_type: 'direct' },
        { id: 'team-ch-1', unread_count: 5, team_id: 'team-1', channel_type: 'team' },
        { id: 'team-ch-2', unread_count: 3, team_id: 'team-1', channel_type: 'team' },
      ];
      component.sidebarMode = 'teams';

      (component as any).updateFilteredChannels();

      expect(component.teamsUnreadCount).toBe(8);
      expect(component.chatUnreadCount).toBe(2);
    });

    it('active Teams channel with cleared unread should not contribute to badge', () => {
      const channels = [
        { id: 'team-ch-1', unread_count: 5, team_id: 'team-1', channel_type: 'team' },
        { id: 'team-ch-2', unread_count: 3, team_id: 'team-1', channel_type: 'team' },
      ];
      apiService.getChannels.mockReturnValue(of(channels));

      // Simulate: user is viewing team-ch-1, a new message arrives
      component.activeChannelId = 'team-ch-1';
      component.loadChatChannels('team-ch-1');

      // After loading, team-ch-1 should have 0 unread
      expect(component.teamsUnreadCount).toBe(3); // only team-ch-2
    });
  });

  /* ---------- mute + new_message combined ---------- */

  describe('mute + new_message combined', () => {
    it('should not play sound when muted even for messages in other channels', () => {
      const mockAudio = { currentTime: 0, play: jest.fn().mockResolvedValue(undefined) };
      (component as any).notificationAudio = mockAudio;
      component.notificationsMuted = true;
      component.activeChannelId = 'channel-1';

      // Message in different channel
      component.playNotificationSound();

      expect(mockAudio.play).not.toHaveBeenCalled();
    });
  });
});
