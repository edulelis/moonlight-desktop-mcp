// Headless Moonlight GameStream client. Session secrets arrive on stdin, never
// in argv or stdout. It atomically publishes the newest decoded RGB PPM frame.

#include <Limelight.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/mem.h>
#include <libavutil/time.h>
#include <libswscale/swscale.h>

#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#ifndef PATH_MAX
#define PATH_MAX 4096
#endif
#define fileno _fileno
#else
#include <unistd.h>
#endif

#define LINE_SIZE 4096
#define MIN_FRAME_INTERVAL_US 200000

typedef struct {
    char host[256], app_version[64], gfe_version[64], rtsp_url[1024];
    char frame_path[PATH_MAX], input_key_hex[33], input_iv_hex[33];
    int codec_mode_support, width, height, fps, bitrate;
} SessionConfig;

typedef struct {
    AVCodecContext* decoder;
    AVFrame* frame;
    struct SwsContext* scaler;
    uint64_t sequence;
    int64_t last_frame_us;
} VideoState;

static SessionConfig Config;
static VideoState Video;

static void restrict_frame_file(FILE* output) {
#ifndef _WIN32
    fchmod(fileno(output), S_IRUSR | S_IWUSR);
#else
    // The user-profile ACL supplies the equivalent Windows protection. POSIX
    // file-mode bits do not map to Windows ACLs, so do not weaken them here.
    (void)output;
#endif
}

static int flush_frame_file(FILE* output) {
    fflush(output);
#ifdef _WIN32
    return _commit(fileno(output));
#else
    return fsync(fileno(output));
#endif
}

static int replace_frame_file(const char* temporary, const char* destination) {
#ifdef _WIN32
    return MoveFileExA(temporary, destination, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) ? 0 : -1;
#else
    return rename(temporary, destination);
#endif
}

static void event(const char* type, const char* detail) {
    if (detail == NULL) printf("{\"type\":\"%s\"}\n", type);
    else printf("{\"type\":\"%s\",\"detail\":\"%s\"}\n", type, detail);
    fflush(stdout);
}

static void stage(const char* type, int stage_number, int error_code) {
    const char* name = LiGetStageName(stage_number);
    printf("{\"type\":\"%s\",\"stage\":\"%s\",\"errorCode\":%d}\n", type, name == NULL ? "unknown" : name, error_code);
    fflush(stdout);
}

static void connection_started(void) { event("connected", NULL); }
static void connection_terminated(int code) { printf("{\"type\":\"terminated\",\"errorCode\":%d}\n", code); fflush(stdout); }
static void stage_starting(int number) { stage("stage_starting", number, 0); }
static void stage_failed(int number, int code) { stage("stage_failed", number, code); }

static void video_cleanup(void) {
    sws_freeContext(Video.scaler); Video.scaler = NULL;
    av_frame_free(&Video.frame);
    avcodec_free_context(&Video.decoder);
}

static int video_setup(int format, int width, int height, int redraw_rate, void* context, int flags) {
    (void)width; (void)height; (void)redraw_rate; (void)context; (void)flags;
    if ((format & VIDEO_FORMAT_MASK_H264) == 0) { event("decoder_error", "Only H.264 is enabled by this prototype"); return -1; }
    video_cleanup();
    const AVCodec* codec = avcodec_find_decoder(AV_CODEC_ID_H264);
    Video.decoder = codec == NULL ? NULL : avcodec_alloc_context3(codec);
    Video.frame = av_frame_alloc();
    if (Video.decoder == NULL || Video.frame == NULL) { event("decoder_error", "Unable to allocate FFmpeg decoder state"); video_cleanup(); return -1; }
    Video.decoder->thread_count = 0;
    Video.decoder->thread_type = FF_THREAD_FRAME;
    if (avcodec_open2(Video.decoder, codec, NULL) < 0) { event("decoder_error", "Unable to open FFmpeg H.264 decoder"); video_cleanup(); return -1; }
    Video.last_frame_us = 0;
    return 0;
}

static int write_frame(AVFrame* source) {
    int64_t now = av_gettime_relative();
    if (now - Video.last_frame_us < MIN_FRAME_INTERVAL_US) return 0;
    int width = source->width, height = source->height;
    if (width <= 0 || height <= 0) return -1;
    Video.scaler = sws_getCachedContext(Video.scaler, width, height, (enum AVPixelFormat)source->format, width, height, AV_PIX_FMT_RGB24, SWS_BILINEAR, NULL, NULL, NULL);
    if (Video.scaler == NULL) { event("decoder_error", "Unable to create RGB frame scaler"); return -1; }
    uint8_t* rgb[4] = {0}; int stride[4] = {0};
    if (av_image_alloc(rgb, stride, width, height, AV_PIX_FMT_RGB24, 1) < 0) { event("decoder_error", "Unable to allocate RGB frame"); return -1; }
    sws_scale(Video.scaler, (const uint8_t* const*)source->data, source->linesize, 0, height, rgb, stride);
    char temporary[PATH_MAX + 8];
    int length = snprintf(temporary, sizeof(temporary), "%s.tmp", Config.frame_path);
    if (length < 0 || (size_t)length >= sizeof(temporary)) { av_freep(&rgb[0]); event("decoder_error", "Frame path is too long"); return -1; }
    FILE* output = fopen(temporary, "wb");
    if (output == NULL) { av_freep(&rgb[0]); event("decoder_error", "Unable to write frame file"); return -1; }
    restrict_frame_file(output);
    fprintf(output, "P6\n%d %d\n255\n", width, height);
    for (int row = 0; row < height; row++) fwrite(rgb[0] + row * stride[0], 1, (size_t)width * 3, output);
    if (flush_frame_file(output) != 0) { fclose(output); av_freep(&rgb[0]); event("decoder_error", "Unable to flush the newest frame"); return -1; }
    fclose(output); av_freep(&rgb[0]);
    if (replace_frame_file(temporary, Config.frame_path) != 0) { event("decoder_error", "Unable to publish the newest frame"); return -1; }
    Video.last_frame_us = now; Video.sequence++;
    printf("{\"type\":\"frame\",\"sequence\":%llu,\"width\":%d,\"height\":%d}\n", (unsigned long long)Video.sequence, width, height);
    fflush(stdout);
    return 0;
}

static int submit_decode_unit(PDECODE_UNIT unit) {
    AVPacket* packet = av_packet_alloc();
    if (packet == NULL || av_new_packet(packet, unit->fullLength) < 0) { av_packet_free(&packet); return DR_NEED_IDR; }
    int offset = 0;
    for (PLENTRY entry = unit->bufferList; entry != NULL; entry = entry->next) {
        if (entry->length <= 0 || offset + entry->length > unit->fullLength) { av_packet_free(&packet); return DR_NEED_IDR; }
        memcpy(packet->data + offset, entry->data, (size_t)entry->length); offset += entry->length;
    }
    if (offset != unit->fullLength || avcodec_send_packet(Video.decoder, packet) < 0) { av_packet_free(&packet); return DR_NEED_IDR; }
    av_packet_free(&packet);
    for (;;) {
        int result = avcodec_receive_frame(Video.decoder, Video.frame);
        if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) return DR_OK;
        if (result < 0) return DR_NEED_IDR;
        if (write_frame(Video.frame) != 0) return DR_NEED_IDR;
        av_frame_unref(Video.frame);
    }
}

static int audio_init(int config, const POPUS_MULTISTREAM_CONFIGURATION opus, void* context, int flags) { (void)config; (void)opus; (void)context; (void)flags; return 0; }
static void audio_sample(char* data, int length) { (void)data; (void)length; }

static bool decode_hex(const char* input, uint8_t* output, size_t output_length) {
    if (strlen(input) != output_length * 2) return false;
    for (size_t i = 0; i < output_length; i++) {
        char pair[3] = {input[i * 2], input[i * 2 + 1], '\0'}; char* end = NULL;
        unsigned long value = strtoul(pair, &end, 16);
        if (end == NULL || *end != '\0' || value > 255) return false;
        output[i] = (uint8_t)value;
    }
    return true;
}

static void copy_value(char* destination, size_t size, const char* source) { snprintf(destination, size, "%s", source); }

static bool read_config(void) {
    char line[LINE_SIZE];
    while (fgets(line, sizeof(line), stdin) != NULL) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strcmp(line, "start") == 0) break;
        char* separator = strchr(line, '='); if (separator == NULL) continue;
        *separator = '\0'; const char* key = line; const char* value = separator + 1;
        if (strcmp(key, "host") == 0) copy_value(Config.host, sizeof(Config.host), value);
        else if (strcmp(key, "app_version") == 0) copy_value(Config.app_version, sizeof(Config.app_version), value);
        else if (strcmp(key, "gfe_version") == 0) copy_value(Config.gfe_version, sizeof(Config.gfe_version), value);
        else if (strcmp(key, "rtsp_url") == 0) copy_value(Config.rtsp_url, sizeof(Config.rtsp_url), value);
        else if (strcmp(key, "frame_path") == 0) copy_value(Config.frame_path, sizeof(Config.frame_path), value);
        else if (strcmp(key, "input_key_hex") == 0) copy_value(Config.input_key_hex, sizeof(Config.input_key_hex), value);
        else if (strcmp(key, "input_iv_hex") == 0) copy_value(Config.input_iv_hex, sizeof(Config.input_iv_hex), value);
        else if (strcmp(key, "codec_mode_support") == 0) Config.codec_mode_support = atoi(value);
        else if (strcmp(key, "width") == 0) Config.width = atoi(value);
        else if (strcmp(key, "height") == 0) Config.height = atoi(value);
        else if (strcmp(key, "fps") == 0) Config.fps = atoi(value);
        else if (strcmp(key, "bitrate") == 0) Config.bitrate = atoi(value);
    }
    return Config.host[0] && Config.app_version[0] && Config.frame_path[0] && Config.width > 0 && Config.height > 0 && Config.fps > 0 && Config.bitrate > 0 &&
        decode_hex(Config.input_key_hex, (uint8_t[16]){0}, 16) && decode_hex(Config.input_iv_hex, (uint8_t[16]){0}, 16);
}

static int button_from_name(const char* name) { if (strcmp(name, "left") == 0) return BUTTON_LEFT; if (strcmp(name, "middle") == 0) return BUTTON_MIDDLE; if (strcmp(name, "right") == 0) return BUTTON_RIGHT; return 0; }

static bool send_text_hex(const char* hex) {
    size_t characters = strlen(hex); if (characters == 0 || characters % 2 || characters > 8192) return false;
    size_t length = characters / 2; char* text = malloc(length);
    if (text == NULL || !decode_hex(hex, (uint8_t*)text, length)) { free(text); return false; }
    int result = LiSendUtf8TextEvent(text, (unsigned int)length); free(text); return result == 0;
}

static bool command(char* line) {
    int result = -1, x, y, width, height, vk, modifiers, scroll_amount; char first[32], second[32];
    if (strcmp(line, "stop") == 0) { LiStopConnection(); event("stopped", NULL); return false; }
    if (strcmp(line, "frame") == 0) { LiRequestIdrFrame(); event("frame_requested", NULL); return true; }
    if (strcmp(line, "status") == 0) { uint32_t rtt = 0, variance = 0; if (LiGetEstimatedRttInfo(&rtt, &variance)) printf("{\"type\":\"status\",\"rttMs\":%u,\"rttVarianceMs\":%u}\n", rtt, variance); else printf("{\"type\":\"status\"}\n"); fflush(stdout); return true; }
    if (sscanf(line, "mouse %d %d %d %d", &x, &y, &width, &height) == 4 && x >= 0 && y >= 0 && width > 0 && height > 0 && x <= SHRT_MAX && y <= SHRT_MAX && width <= SHRT_MAX && height <= SHRT_MAX) result = LiSendMousePositionEvent((short)x, (short)y, (short)width, (short)height);
    else if (sscanf(line, "button %31s %31s", first, second) == 2) { int button = button_from_name(first), action = strcmp(second, "down") == 0 ? BUTTON_ACTION_PRESS : strcmp(second, "up") == 0 ? BUTTON_ACTION_RELEASE : 0; if (button && action) result = LiSendMouseButtonEvent((char)action, button); }
    else if (sscanf(line, "key %d %31s %d", &vk, first, &modifiers) == 3 && vk >= 0 && vk <= UINT16_MAX && modifiers >= 0 && modifiers <= UCHAR_MAX) { int action = strcmp(first, "down") == 0 ? KEY_ACTION_DOWN : strcmp(first, "up") == 0 ? KEY_ACTION_UP : 0; if (action) result = LiSendKeyboardEvent2((short)vk, (char)action, (char)modifiers, SS_KBE_FLAG_NON_NORMALIZED); }
    else if (sscanf(line, "scroll %d", &scroll_amount) == 1 && scroll_amount >= SHRT_MIN && scroll_amount <= SHRT_MAX) result = LiSendHighResScrollEvent((short)scroll_amount);
    else if (strncmp(line, "text ", 5) == 0) result = send_text_hex(line + 5) ? 0 : -1;
    printf("{\"type\":\"input\",\"result\":%d}\n", result); fflush(stdout); return true;
}

int main(void) {
    memset(&Config, 0, sizeof(Config)); memset(&Video, 0, sizeof(Video));
    if (!read_config()) { event("configuration_error", "Missing or invalid session configuration"); return 2; }
    STREAM_CONFIGURATION stream; LiInitializeStreamConfiguration(&stream);
    stream.width = Config.width; stream.height = Config.height; stream.fps = Config.fps; stream.bitrate = Config.bitrate; stream.packetSize = 1392; stream.streamingRemotely = STREAM_CFG_LOCAL; stream.audioConfiguration = AUDIO_CONFIGURATION_STEREO; stream.supportedVideoFormats = VIDEO_FORMAT_H264; stream.colorSpace = COLORSPACE_REC_709; stream.colorRange = COLOR_RANGE_LIMITED; stream.encryptionFlags = ENCFLG_NONE;
    decode_hex(Config.input_key_hex, (uint8_t*)stream.remoteInputAesKey, sizeof(stream.remoteInputAesKey)); decode_hex(Config.input_iv_hex, (uint8_t*)stream.remoteInputAesIv, sizeof(stream.remoteInputAesIv));
    SERVER_INFORMATION server; LiInitializeServerInformation(&server);
    server.address = Config.host; server.serverInfoAppVersion = Config.app_version; server.serverInfoGfeVersion = Config.gfe_version[0] ? Config.gfe_version : NULL; server.rtspSessionUrl = Config.rtsp_url[0] ? Config.rtsp_url : NULL; server.serverCodecModeSupport = Config.codec_mode_support;
    CONNECTION_LISTENER_CALLBACKS connection_callbacks; LiInitializeConnectionCallbacks(&connection_callbacks);
    connection_callbacks.stageStarting = stage_starting; connection_callbacks.stageFailed = stage_failed; connection_callbacks.connectionStarted = connection_started; connection_callbacks.connectionTerminated = connection_terminated;
    DECODER_RENDERER_CALLBACKS video_callbacks; LiInitializeVideoCallbacks(&video_callbacks);
    video_callbacks.setup = video_setup; video_callbacks.cleanup = video_cleanup; video_callbacks.submitDecodeUnit = submit_decode_unit; video_callbacks.capabilities = CAPABILITY_DIRECT_SUBMIT;
    AUDIO_RENDERER_CALLBACKS audio_callbacks; LiInitializeAudioCallbacks(&audio_callbacks);
    audio_callbacks.init = audio_init; audio_callbacks.decodeAndPlaySample = audio_sample; audio_callbacks.capabilities = CAPABILITY_DIRECT_SUBMIT;
    int start_result = LiStartConnection(&server, &stream, &connection_callbacks, &video_callbacks, &audio_callbacks, NULL, 0, NULL, 0);
    if (start_result != 0) { printf("{\"type\":\"connection_error\",\"errorCode\":%d}\n", start_result); fflush(stdout); video_cleanup(); return 1; }
    char line[LINE_SIZE]; while (fgets(line, sizeof(line), stdin) != NULL) { line[strcspn(line, "\r\n")] = '\0'; if (!command(line)) break; }
    LiStopConnection(); video_cleanup(); return 0;
}
