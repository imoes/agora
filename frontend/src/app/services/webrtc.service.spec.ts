import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { WebRTCService, Participant } from './webrtc.service';
import { WebSocketService } from './websocket.service';
import { AuthService, User } from '@core/services/auth.service';
import { Subject } from 'rxjs';

/* ---------- helpers ---------- */

function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    display_name: 'Test User',
    avatar_path: null,
    status: 'online',
    status_message: null,
    created_at: '2024-01-01',
    ...overrides,
  };
}

function fakeMediaStream(opts: { audio?: boolean; video?: boolean } = { audio: true, video: true }): MediaStream {
  const tracks: MediaStreamTrack[] = [];
  if (opts.audio) {
    tracks.push({ kind: 'audio', enabled: true, stop: jest.fn() } as any);
  }
  if (opts.video) {
    tracks.push({ kind: 'video', enabled: true, stop: jest.fn() } as any);
  }
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as any;
}

describe('WebRTCService', () => {
  let service: WebRTCService;
  let wsSubject: Subject<any>;
  const wsSendMock = jest.fn();
  const wsConnectMock = jest.fn();
  const wsWaitForOpenMock = jest.fn();

  const wsService = {
    connect: wsConnectMock,
    send: wsSendMock,
    disconnect: jest.fn(),
    waitForOpen: wsWaitForOpenMock,
  };

  const authService = {
    getToken: jest.fn().mockReturnValue('test-token'),
    getCurrentUser: jest.fn().mockReturnValue(mockUser()),
  };

  beforeEach(() => {
    // navigator.mediaDevices doesn't exist in jsdom – create a mock
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: jest.fn(), getDisplayMedia: jest.fn() },
        configurable: true,
        writable: true,
      });
    }

    wsSubject = new Subject<any>();
    wsConnectMock.mockReturnValue(wsSubject.asObservable());
    wsWaitForOpenMock.mockReturnValue(Promise.resolve());
    wsSendMock.mockClear();

    TestBed.configureTestingModule({
      providers: [
        WebRTCService,
        { provide: WebSocketService, useValue: wsService },
        { provide: AuthService, useValue: authService },
      ],
    });

    service = TestBed.inject(WebRTCService);
  });

  afterEach(() => {
    service.endCall();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /* --------- startCall --------- */

  describe('startCall', () => {
    let getUserMediaSpy: jest.SpyInstance;

    beforeEach(() => {
      const stream = fakeMediaStream();
      getUserMediaSpy = jest.spyOn(navigator.mediaDevices, 'getUserMedia')
        .mockResolvedValue(stream);
    });

    afterEach(() => {
      getUserMediaSpy.mockRestore();
    });

    it('should request video+audio by default', async () => {
      await service.startCall('ch1');
      expect(getUserMediaSpy).toHaveBeenCalledWith({ video: true, audio: true });
    });

    it('should request audio-only when audioOnly=true', async () => {
      await service.startCall('ch1', true);
      expect(getUserMediaSpy).toHaveBeenCalledWith({ audio: true, video: false });
    });

    it('should emit localStream after getUserMedia', async () => {
      let emittedStream: MediaStream | null = null;
      service.localStream$.subscribe((s) => (emittedStream = s));

      await service.startCall('ch1');
      expect(emittedStream).toBeTruthy();
    });

    it('should subscribe to WebSocket signaling', async () => {
      await service.startCall('ch1');
      expect(wsConnectMock).toHaveBeenCalledWith('ch1');
    });

    it('should wait for WebSocket open before sending video_call_start', async () => {
      const callOrder: string[] = [];
      wsWaitForOpenMock.mockImplementation(() => {
        callOrder.push('waitForOpen');
        return Promise.resolve();
      });
      wsSendMock.mockImplementation(() => {
        callOrder.push('send');
      });

      await service.startCall('ch1');

      expect(callOrder).toEqual(['waitForOpen', 'send']);
      expect(wsSendMock).toHaveBeenCalledWith('ch1', { type: 'video_call_start' });
    });

    it('should emit error when getUserMedia rejects', async () => {
      getUserMediaSpy.mockRejectedValue(new Error('Permission denied'));

      let error = '';
      service.error$.subscribe((e) => (error = e));
      await service.startCall('ch1');

      expect(error).toContain('Zugriff auf Kamera/Mikrofon verweigert');
      // wsConnect should not have been called for THIS startCall invocation
      // (previous tests may have called it, so we check it wasn't called again)
      const callCountBefore = wsConnectMock.mock.calls.length;
      // It was already called before the getUserMedia failure in startCall,
      // so we just verify that the call did NOT proceed to send
      expect(wsSendMock).not.toHaveBeenCalledWith('ch1', { type: 'video_call_start' });
    });
  });

  /* --------- handleSignaling --------- */

  describe('handleSignaling', () => {
    it('should ignore video_call_start from current user', async () => {
      let participants: Map<string, Participant> = new Map();
      service.participants$.subscribe((p) => (participants = p));

      await service.handleSignaling({ type: 'video_call_start', user_id: 'user-1', display_name: 'Me' });
      expect(participants.size).toBe(0);
    });

    it('should handle video_call_end by removing participant', async () => {
      let participants: Map<string, Participant> = new Map();
      service.participants$.subscribe((p) => (participants = p));

      await service.handleSignaling({ type: 'video_call_end', user_id: 'user-2' });
      expect(participants.has('user-2')).toBe(false);
    });

    it('should track screen share start from other users', async () => {
      let presenter: { userId: string; displayName: string } | null = null;
      service.presenter$.subscribe((p) => (presenter = p));

      await service.handleSignaling({
        type: 'screen_share_start',
        user_id: 'user-2',
        display_name: 'Other User',
      });

      expect(presenter).toEqual(expect.objectContaining({ userId: 'user-2', displayName: 'Other User' }));
    });

    it('should ignore screen share start from current user', async () => {
      let presenter: { userId: string; displayName: string } | null = null;
      service.presenter$.subscribe((p) => (presenter = p));

      await service.handleSignaling({
        type: 'screen_share_start',
        user_id: 'user-1',
        display_name: 'Test User',
      });

      expect(presenter).toBeNull();
    });

    it('should clear presenter on screen share stop', async () => {
      let presenter: { userId: string; displayName: string } | null = null;
      service.presenter$.subscribe((p) => (presenter = p));

      await service.handleSignaling({
        type: 'screen_share_start',
        user_id: 'user-2',
        display_name: 'Other',
      });
      expect(presenter).toBeTruthy();

      await service.handleSignaling({
        type: 'screen_share_stop',
        user_id: 'user-2',
      });
      expect(presenter).toBeNull();
    });

    it('should not clear presenter if a different user stops sharing', async () => {
      let presenter: { userId: string; displayName: string } | null = null;
      service.presenter$.subscribe((p) => (presenter = p));

      await service.handleSignaling({
        type: 'screen_share_start',
        user_id: 'user-2',
        display_name: 'Other',
      });

      await service.handleSignaling({
        type: 'screen_share_stop',
        user_id: 'user-3',
      });

      expect(presenter).toEqual(expect.objectContaining({ userId: 'user-2', displayName: 'Other' }));
    });
  });

  /* --------- toggleAudio / toggleVideo --------- */

  describe('toggleAudio', () => {
    it('should toggle audio track enabled state', async () => {
      const stream = fakeMediaStream();
      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
      await service.startCall('ch1');

      const track = stream.getAudioTracks()[0];
      expect(track.enabled).toBe(true);

      const result = service.toggleAudio();
      expect(track.enabled).toBe(false);
      expect(result).toBe(false);

      const result2 = service.toggleAudio();
      expect(track.enabled).toBe(true);
      expect(result2).toBe(true);
    });

    it('should return false when no stream exists', () => {
      expect(service.toggleAudio()).toBe(false);
    });
  });

  describe('toggleVideo', () => {
    it('should toggle video track enabled state', async () => {
      const stream = fakeMediaStream();
      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
      await service.startCall('ch1');

      const track = stream.getVideoTracks()[0];
      expect(track.enabled).toBe(true);

      const result = service.toggleVideo();
      expect(track.enabled).toBe(false);
      expect(result).toBe(false);
    });

    it('should return false when no stream exists', () => {
      expect(service.toggleVideo()).toBe(false);
    });
  });

  /* --------- endCall --------- */

  describe('endCall', () => {
    it('should send video_call_end and clean up streams', async () => {
      const stream = fakeMediaStream();
      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
      await service.startCall('ch1');

      wsSendMock.mockClear();
      service.endCall();

      expect(wsSendMock).toHaveBeenCalledWith('ch1', { type: 'video_call_end' });
      stream.getTracks().forEach((t) => {
        expect(t.stop).toHaveBeenCalled();
      });

      let localStream: MediaStream | null = null;
      service.localStream$.subscribe((s) => (localStream = s));
      expect(localStream).toBeNull();
    });

    it('should clear participants on endCall', async () => {
      const stream = fakeMediaStream();
      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
      await service.startCall('ch1');

      service.endCall();

      let participants: Map<string, Participant> = new Map();
      service.participants$.subscribe((p) => (participants = p));
      expect(participants.size).toBe(0);
    });

    it('should not fail when called without active call', () => {
      expect(() => service.endCall()).not.toThrow();
    });
  });
});
