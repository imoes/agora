#ifndef AGORA_API_CLIENT_H
#define AGORA_API_CLIENT_H

#include <libsoup/soup.h>
#include <json-glib/json-glib.h>

typedef struct {
    SoupSession *session;
    char *base_url;
    char *token;
} AgoraApiClient;

AgoraApiClient *agora_api_client_new(const char *base_url);
void agora_api_client_free(AgoraApiClient *client);
void agora_api_client_set_token(AgoraApiClient *client, const char *token);

/**
 * Login and return JSON response. Caller must unref the returned JsonNode.
 * Returns NULL on error (sets GError).
 */
JsonNode *agora_api_client_login(AgoraApiClient *client,
                                 const char *username,
                                 const char *password,
                                 GError **error);

/**
 * GET request returning a JsonNode. Caller must unref.
 */
JsonNode *agora_api_client_get(AgoraApiClient *client,
                               const char *path,
                               GError **error);

/**
 * POST request with JSON body, returning a JsonNode. Caller must unref.
 */
JsonNode *agora_api_client_post(AgoraApiClient *client,
                                const char *path,
                                const char *json_body,
                                GError **error);

#endif /* AGORA_API_CLIENT_H */
