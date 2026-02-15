#include "api_client.h"
#include <string.h>

AgoraApiClient *agora_api_client_new(const char *base_url)
{
    AgoraApiClient *client = g_new0(AgoraApiClient, 1);
    client->session = soup_session_new_with_options(
        SOUP_SESSION_SSL_STRICT, FALSE,  /* Accept self-signed certs */
        NULL);
    client->base_url = g_strdup(base_url);
    client->token = NULL;
    return client;
}

void agora_api_client_free(AgoraApiClient *client)
{
    if (!client) return;
    g_object_unref(client->session);
    g_free(client->base_url);
    g_free(client->token);
    g_free(client);
}

void agora_api_client_set_token(AgoraApiClient *client, const char *token)
{
    g_free(client->token);
    client->token = g_strdup(token);
}

static JsonNode *parse_response(SoupMessage *msg, GError **error)
{
    if (msg->status_code < 200 || msg->status_code >= 300) {
        g_set_error(error, g_quark_from_static_string("agora"),
                    (int)msg->status_code,
                    "HTTP %u: %s", msg->status_code, msg->reason_phrase);
        return NULL;
    }

    SoupMessageBody *body = msg->response_body;
    if (!body || !body->data || body->length == 0) {
        g_set_error(error, g_quark_from_static_string("agora"), 0,
                    "Empty response body");
        return NULL;
    }

    JsonParser *parser = json_parser_new();
    gboolean ok = json_parser_load_from_data(parser, body->data,
                                              (gssize)body->length, error);
    if (!ok) {
        g_object_unref(parser);
        return NULL;
    }

    JsonNode *root = json_node_copy(json_parser_get_root(parser));
    g_object_unref(parser);
    return root;
}

static void add_auth_header(AgoraApiClient *client, SoupMessage *msg)
{
    if (client->token) {
        char *header = g_strdup_printf("Bearer %s", client->token);
        soup_message_headers_replace(msg->request_headers, "Authorization", header);
        g_free(header);
    }
}

JsonNode *agora_api_client_login(AgoraApiClient *client,
                                 const char *username,
                                 const char *password,
                                 GError **error)
{
    char *url = g_strdup_printf("%s/api/auth/login", client->base_url);

    JsonBuilder *builder = json_builder_new();
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "username");
    json_builder_add_string_value(builder, username);
    json_builder_set_member_name(builder, "password");
    json_builder_add_string_value(builder, password);
    json_builder_end_object(builder);

    JsonGenerator *gen = json_generator_new();
    json_generator_set_root(gen, json_builder_get_root(builder));
    char *body = json_generator_to_data(gen, NULL);

    SoupMessage *msg = soup_message_new("POST", url);
    soup_message_set_request(msg, "application/json",
                             SOUP_MEMORY_COPY, body, strlen(body));

    soup_session_send_message(client->session, msg);
    JsonNode *result = parse_response(msg, error);

    g_free(url);
    g_free(body);
    g_object_unref(gen);
    g_object_unref(builder);
    g_object_unref(msg);

    return result;
}

JsonNode *agora_api_client_get(AgoraApiClient *client,
                               const char *path,
                               GError **error)
{
    char *url = g_strdup_printf("%s%s", client->base_url, path);
    SoupMessage *msg = soup_message_new("GET", url);
    add_auth_header(client, msg);

    soup_session_send_message(client->session, msg);
    JsonNode *result = parse_response(msg, error);

    g_free(url);
    g_object_unref(msg);
    return result;
}

JsonNode *agora_api_client_post(AgoraApiClient *client,
                                const char *path,
                                const char *json_body,
                                GError **error)
{
    char *url = g_strdup_printf("%s%s", client->base_url, path);
    SoupMessage *msg = soup_message_new("POST", url);
    add_auth_header(client, msg);

    if (json_body) {
        soup_message_set_request(msg, "application/json",
                                 SOUP_MEMORY_COPY, json_body, strlen(json_body));
    }

    soup_session_send_message(client->session, msg);
    JsonNode *result = parse_response(msg, error);

    g_free(url);
    g_object_unref(msg);
    return result;
}
