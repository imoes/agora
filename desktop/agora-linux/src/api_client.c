#include "api_client.h"
#include <string.h>

/* Accept all SSL certificates (for self-signed certs) */
static gboolean accept_certificate_cb(SoupMessage *msg, GTlsCertificate *cert,
                                       GTlsCertificateFlags errors, gpointer data)
{
    (void)msg; (void)cert; (void)errors; (void)data;
    return TRUE;
}

/* Read full response body from GInputStream */
static char *read_stream(GInputStream *stream, gsize *out_length, GError **error)
{
    GByteArray *array = g_byte_array_new();
    guint8 buf[4096];
    gssize n;
    while ((n = g_input_stream_read(stream, buf, sizeof(buf), NULL, error)) > 0)
        g_byte_array_append(array, buf, (guint)n);
    if (n < 0) {
        g_byte_array_free(array, TRUE);
        return NULL;
    }
    if (out_length) *out_length = array->len;
    g_byte_array_append(array, (guint8 *)"\0", 1);
    return (char *)g_byte_array_free(array, FALSE);
}

AgoraApiClient *agora_api_client_new(const char *base_url)
{
    AgoraApiClient *client = g_new0(AgoraApiClient, 1);
    client->session = soup_session_new();
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

static void add_auth_header(AgoraApiClient *client, SoupMessage *msg)
{
    if (client->token) {
        char *header = g_strdup_printf("Bearer %s", client->token);
        soup_message_headers_replace(soup_message_get_request_headers(msg),
                                      "Authorization", header);
        g_free(header);
    }
}

/* Send a request and parse the JSON response */
static JsonNode *do_request(AgoraApiClient *client, SoupMessage *msg, GError **error)
{
    g_signal_connect(msg, "accept-certificate",
                     G_CALLBACK(accept_certificate_cb), NULL);

    GInputStream *stream = soup_session_send(client->session, msg, NULL, error);
    if (!stream) return NULL;

    guint status = soup_message_get_status(msg);
    if (status < 200 || status >= 300) {
        g_set_error(error, g_quark_from_static_string("agora"),
                    (int)status,
                    "HTTP %u: %s", status, soup_message_get_reason_phrase(msg));
        g_object_unref(stream);
        return NULL;
    }

    gsize length = 0;
    char *body = read_stream(stream, &length, error);
    g_object_unref(stream);

    if (!body || length == 0) {
        g_free(body);
        return NULL;
    }

    JsonParser *parser = json_parser_new();
    gboolean ok = json_parser_load_from_data(parser, body, (gssize)length, error);
    g_free(body);
    if (!ok) {
        g_object_unref(parser);
        return NULL;
    }

    JsonNode *root = json_node_copy(json_parser_get_root(parser));
    g_object_unref(parser);
    return root;
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
    GBytes *bytes = g_bytes_new(body, strlen(body));
    soup_message_set_request_body_from_bytes(msg, "application/json", bytes);
    g_bytes_unref(bytes);

    JsonNode *result = do_request(client, msg, error);

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

    JsonNode *result = do_request(client, msg, error);

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
        GBytes *bytes = g_bytes_new(json_body, strlen(json_body));
        soup_message_set_request_body_from_bytes(msg, "application/json", bytes);
        g_bytes_unref(bytes);
    }

    JsonNode *result = do_request(client, msg, error);

    g_free(url);
    g_object_unref(msg);
    return result;
}

JsonNode *agora_api_client_patch(AgoraApiClient *client,
                                  const char *path,
                                  const char *json_body,
                                  GError **error)
{
    char *url = g_strdup_printf("%s%s", client->base_url, path);
    SoupMessage *msg = soup_message_new("PATCH", url);
    add_auth_header(client, msg);

    if (json_body) {
        GBytes *bytes = g_bytes_new(json_body, strlen(json_body));
        soup_message_set_request_body_from_bytes(msg, "application/json", bytes);
        g_bytes_unref(bytes);
    }

    JsonNode *result = do_request(client, msg, error);

    g_free(url);
    g_object_unref(msg);
    return result;
}

JsonNode *agora_api_client_put(AgoraApiClient *client,
                                const char *path,
                                const char *json_body,
                                GError **error)
{
    char *url = g_strdup_printf("%s%s", client->base_url, path);
    SoupMessage *msg = soup_message_new("PUT", url);
    add_auth_header(client, msg);

    if (json_body) {
        GBytes *bytes = g_bytes_new(json_body, strlen(json_body));
        soup_message_set_request_body_from_bytes(msg, "application/json", bytes);
        g_bytes_unref(bytes);
    }

    JsonNode *result = do_request(client, msg, error);

    g_free(url);
    g_object_unref(msg);
    return result;
}

JsonNode *agora_api_client_delete(AgoraApiClient *client,
                                   const char *path,
                                   GError **error)
{
    char *url = g_strdup_printf("%s%s", client->base_url, path);
    SoupMessage *msg = soup_message_new("DELETE", url);
    add_auth_header(client, msg);

    g_signal_connect(msg, "accept-certificate",
                     G_CALLBACK(accept_certificate_cb), NULL);

    GInputStream *stream = soup_session_send(client->session, msg, NULL, error);
    if (!stream) {
        g_free(url);
        g_object_unref(msg);
        return NULL;
    }

    guint status = soup_message_get_status(msg);

    /* DELETE may return empty body on success */
    if (status >= 200 && status < 300) {
        g_object_unref(stream);
        g_free(url);
        g_object_unref(msg);
        return NULL;
    }

    /* Parse error response */
    gsize length = 0;
    char *body = read_stream(stream, &length, error);
    g_object_unref(stream);

    JsonNode *result = NULL;
    if (body && length > 0) {
        JsonParser *parser = json_parser_new();
        if (json_parser_load_from_data(parser, body, (gssize)length, NULL)) {
            result = json_node_copy(json_parser_get_root(parser));
        }
        g_object_unref(parser);
    }

    if (!result && status >= 300) {
        g_set_error(error, g_quark_from_static_string("agora"),
                    (int)status,
                    "HTTP %u: %s", status, soup_message_get_reason_phrase(msg));
    }

    g_free(body);
    g_free(url);
    g_object_unref(msg);
    return result;
}
