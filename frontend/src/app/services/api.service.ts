import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // Teams
  getTeams(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/teams/`);
  }

  createTeam(data: { name: string; description?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/teams/`, data);
  }

  getTeam(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/teams/${id}`);
  }

  getTeamMembers(teamId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/teams/${teamId}/members`);
  }

  addTeamMember(teamId: string, userId: string, role: string = 'member'): Observable<any> {
    return this.http.post(`${this.baseUrl}/teams/${teamId}/members`, { user_id: userId, role });
  }

  removeTeamMember(teamId: string, userId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/teams/${teamId}/members/${userId}`);
  }

  leaveTeam(teamId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/teams/${teamId}/leave`, {});
  }

  // Channels
  getChannels(teamId?: string): Observable<any[]> {
    let params = new HttpParams();
    if (teamId) params = params.set('team_id', teamId);
    return this.http.get<any[]>(`${this.baseUrl}/channels/`, { params });
  }

  createChannel(data: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/channels/`, data);
  }

  getChannel(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/channels/${id}`);
  }

  updateChannel(channelId: string, data: { name?: string; description?: string }): Observable<any> {
    return this.http.patch(`${this.baseUrl}/channels/${channelId}`, data);
  }

  getChannelMembers(channelId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/channels/${channelId}/members`);
  }

  getReadPosition(channelId: string): Observable<{ last_read_message_id: string | null }> {
    return this.http.get<{ last_read_message_id: string | null }>(`${this.baseUrl}/channels/${channelId}/read-position`);
  }

  updateReadPosition(channelId: string, lastReadMessageId: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/channels/${channelId}/read-position`, { last_read_message_id: lastReadMessageId });
  }

  // Profile
  updateProfile(data: { display_name?: string; email?: string; status_message?: string; status?: string; language?: string; password?: string; current_password?: string }): Observable<any> {
    return this.http.patch(`${this.baseUrl}/auth/me`, data);
  }

  uploadAvatar(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.baseUrl}/auth/me/avatar`, formData);
  }

  getAvatarUrl(avatarPath: string | null): string | null {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    return `${this.baseUrl.replace('/api', '')}${avatarPath}`;
  }

  // Notification sound
  uploadNotificationSound(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.baseUrl}/auth/me/notification-sound`, formData);
  }

  deleteNotificationSound(): Observable<any> {
    return this.http.delete(`${this.baseUrl}/auth/me/notification-sound`);
  }

  getNotificationSoundUrl(soundPath: string | null): string | null {
    if (!soundPath) return null;
    if (soundPath.startsWith('http')) return soundPath;
    return `${this.baseUrl.replace('/api', '')}${soundPath}`;
  }

  // Messages
  getMessages(channelId: string, limit: number = 50, before?: string): Observable<any[]> {
    let params = new HttpParams().set('limit', limit.toString());
    if (before) params = params.set('before', before);
    return this.http.get<any[]>(`${this.baseUrl}/channels/${channelId}/messages/`, { params });
  }

  sendMessage(channelId: string, data: { content: string; message_type?: string; file_reference_id?: string; reply_to_id?: string; reply_to_content?: string; reply_to_sender?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/channels/${channelId}/messages/`, data);
  }

  // Reactions
  addReaction(channelId: string, messageId: string, emoji: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/channels/${channelId}/messages/${messageId}/reactions`, { emoji });
  }

  removeReaction(channelId: string, messageId: string, emoji: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  // Files
  uploadFile(file: File, channelId?: string): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    if (channelId) formData.append('channel_id', channelId);
    return this.http.post(`${this.baseUrl}/files/upload`, formData);
  }

  getChannelFiles(channelId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/files/channel/${channelId}`);
  }

  getTeamFiles(teamId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/files/team/${teamId}`);
  }

  getFileDownloadUrl(refId: string): string {
    const token = localStorage.getItem('access_token') || '';
    return `${this.baseUrl}/files/download/${refId}?token=${encodeURIComponent(token)}`;
  }

  getFileInlineUrl(refId: string): string {
    const token = localStorage.getItem('access_token') || '';
    return `${this.baseUrl}/files/inline/${refId}?token=${encodeURIComponent(token)}`;
  }

  // Feed
  getFeed(limit: number = 50, offset: number = 0, unreadOnly: boolean = false): Observable<any> {
    const params = new HttpParams()
      .set('limit', limit.toString())
      .set('offset', offset.toString())
      .set('unread_only', unreadOnly.toString());
    return this.http.get(`${this.baseUrl}/feed/`, { params });
  }

  markFeedRead(data: { event_ids?: string[]; channel_id?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/feed/read`, data);
  }

  getUnreadCount(): Observable<any> {
    return this.http.get(`${this.baseUrl}/feed/unread-count`);
  }

  // Users
  getUsers(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/users/`);
  }

  searchUsers(query: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/users/`, { params: { search: query } });
  }

  getUser(userId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/users/${userId}`);
  }

  // Direct Messages - find or create 1:1 chat
  findOrCreateDirectChat(userId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/channels/direct`, { user_id: userId });
  }

  // Video
  createVideoRoom(channelId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/video/rooms`, null, { params: { channel_id: channelId } });
  }

  joinVideoRoom(channelId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/video/rooms/${channelId}/join`, null);
  }

  leaveVideoRoom(channelId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/video/rooms/${channelId}/leave`, null);
  }

  getVideoNotes(channelId: string): Observable<{ notes: string }> {
    return this.http.get<{ notes: string }>(`${this.baseUrl}/video/rooms/${channelId}/notes`);
  }

  updateVideoNotes(channelId: string, notes: string): Observable<{ status: string; notes: string }> {
    return this.http.put<{ status: string; notes: string }>(`${this.baseUrl}/video/rooms/${channelId}/notes`, { notes });
  }

  // Channel members
  addChannelMember(channelId: string, userId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/channels/${channelId}/members/${userId}`, null);
  }

  leaveChannel(channelId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/channels/${channelId}/members/me`);
  }

  toggleChannelSubscription(channelId: string): Observable<{ is_subscribed: boolean }> {
    return this.http.post<{ is_subscribed: boolean }>(`${this.baseUrl}/channels/${channelId}/subscribe`, null);
  }

  // Invitations
  sendInvitation(channelId: string, data: { email: string; message?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/invitations/channel/${channelId}`, data);
  }

  getChannelInvitations(channelId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/invitations/channel/${channelId}`);
  }

  acceptInvitation(inviteToken: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/invitations/accept/${inviteToken}`);
  }

  revokeInvitation(invitationId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/invitations/${invitationId}`);
  }

  regenerateInviteToken(channelId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/invitations/channel/${channelId}/regenerate-token`, null);
  }

  getInvitationIcsUrl(channelId: string, invitationId: string): string {
    return `${this.baseUrl}/invitations/channel/${channelId}/ics/${invitationId}`;
  }

  // Delete channel
  deleteChannel(channelId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/channels/${channelId}`);
  }

  // Auth config (LDAP status)
  getAuthConfig(): Observable<{ ldap_enabled: boolean; registration_enabled: boolean }> {
    return this.http.get<any>(`${this.baseUrl}/auth/config`);
  }

  // Calendar
  getCalendarEvents(start?: string, end?: string): Observable<any[]> {
    let params = new HttpParams();
    if (start) params = params.set('start', start);
    if (end) params = params.set('end', end);
    return this.http.get<any[]>(`${this.baseUrl}/calendar/events`, { params });
  }

  createCalendarEvent(data: {
    title: string;
    description?: string;
    start_time: string;
    end_time: string;
    all_day?: boolean;
    location?: string;
    channel_id?: string;
    create_video_call?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/calendar/events`, data);
  }

  updateCalendarEvent(eventId: string, data: any): Observable<any> {
    return this.http.patch(`${this.baseUrl}/calendar/events/${eventId}`, data);
  }

  deleteCalendarEvent(eventId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/calendar/events/${eventId}`);
  }

  getCalendarInvitations(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/calendar/invitations`);
  }

  getCalendarInvitationCount(): Observable<any> {
    return this.http.get(`${this.baseUrl}/calendar/invitations/count`);
  }

  rsvpCalendarEvent(eventId: string, rsvpStatus: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/calendar/events/${eventId}/rsvp`, { status: rsvpStatus });
  }

  getCalendarIntegration(): Observable<any> {
    return this.http.get(`${this.baseUrl}/calendar/integration`);
  }

  saveCalendarIntegration(data: {
    provider: string;
    webdav_url?: string;
    webdav_username?: string;
    webdav_password?: string;
    google_email?: string;
    google_app_password?: string;
    outlook_server_url?: string;
    outlook_username?: string;
    outlook_password?: string;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/calendar/integration`, data);
  }

  deleteCalendarIntegration(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/calendar/integration`);
  }

  getGoogleAuthUrl(): Observable<{ auth_url: string }> {
    return this.http.get<{ auth_url: string }>(`${this.baseUrl}/calendar/google/auth`);
  }

  sendGoogleCallback(code: string): Observable<{ ok: boolean; google_email: string }> {
    return this.http.post<{ ok: boolean; google_email: string }>(
      `${this.baseUrl}/calendar/google/callback`,
      null,
      { params: new HttpParams().set('code', code) },
    );
  }

  syncCalendar(start?: string, end?: string): Observable<any[]> {
    let params = new HttpParams();
    if (start) params = params.set('start', start);
    if (end) params = params.set('end', end);
    return this.http.post<any[]>(`${this.baseUrl}/calendar/sync`, null, { params });
  }

  // Guest meeting access (no auth)
  getGuestMeetingInfo(guestToken: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/calendar/guest/${guestToken}`);
  }

  guestJoinMeeting(guestToken: string, displayName: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/calendar/guest/${guestToken}/join`, {
      display_name: displayName,
    });
  }

  // Admin
  getAdminStats(): Observable<any> {
    return this.http.get(`${this.baseUrl}/admin/stats`);
  }

  getAdminLdapConfig(): Observable<any> {
    return this.http.get(`${this.baseUrl}/admin/ldap-config`);
  }

  toggleUserAdmin(userId: string, isAdmin: boolean): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/toggle-admin`, { user_id: userId, is_admin: isAdmin });
  }

  adminGetUsers(search?: string): Observable<any[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<any[]>(`${this.baseUrl}/admin/users`, { params });
  }

  adminCreateUser(data: { username: string; email: string; password: string; display_name: string; is_admin: boolean }): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/users`, data);
  }

  adminUpdateUser(userId: string, data: { display_name?: string; email?: string; is_admin?: boolean }): Observable<any> {
    return this.http.put(`${this.baseUrl}/admin/users/${userId}`, data);
  }

  adminDeleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/admin/users/${userId}`);
  }

  adminResetPassword(userId: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/users/${userId}/reset-password`, { password });
  }

  // Link preview
  getLinkPreview(url: string): Observable<{ url: string; title: string; description: string; image: string; site_name: string }> {
    return this.http.get<any>(`${this.baseUrl}/link-preview/`, { params: { url } });
  }
}
