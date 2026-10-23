// Includes the real bridge implementation; no GameStream connection is made.
// Synthetic RGB and locally encoded H.264 never contain desktop/private pixels.
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <assert.h>
#include <stdbool.h>

static bool FailClone, FailRgbAllocation;
static AVFrame* test_frame_clone(const AVFrame* source) {
    return FailClone ? NULL : av_frame_clone(source);
}
#include <libavutil/imgutils.h>
static int test_image_alloc(uint8_t* pointers[4], int strides[4], int width, int height, enum AVPixelFormat format, int alignment) {
    return FailRgbAllocation ? AVERROR(ENOMEM) : av_image_alloc(pointers, strides, width, height, format, alignment);
}
#define av_frame_clone test_frame_clone
#define av_image_alloc test_image_alloc
#define main bridge_main
#include "../session_bridge.c"
#undef main
#undef av_frame_clone
#undef av_image_alloc

#define REQUIRE(condition) do { if (!(condition)) { fprintf(stderr, "Native fixture failed at line %d: %s\n", __LINE__, #condition); exit(1); } } while (0)

static AVFrame* rgb_frame(int width, int height, int seed) {
    AVFrame* frame = av_frame_alloc(); REQUIRE(frame != NULL);
    frame->format = AV_PIX_FMT_RGB24; frame->width = width; frame->height = height;
    REQUIRE(av_frame_get_buffer(frame, 32) == 0);
    for (int y = 0; y < height; y++) for (int x = 0; x < width * 3; x++) frame->data[0][y * frame->linesize[0] + x] = (uint8_t)((seed + x + y) % 251);
    return frame;
}

static void check_ppm(const AVFrame* expected) {
    FILE* file = fopen(Config.frame_path, "rb"); REQUIRE(file != NULL);
    int width = 0, height = 0, maximum = 0; char format[3] = {0};
    REQUIRE(fscanf(file, "%2s %d %d %d", format, &width, &height, &maximum) == 4);
    REQUIRE(strcmp(format, "P6") == 0 && width == expected->width && height == expected->height && maximum == 255);
    REQUIRE(fgetc(file) == '\n');
    for (int y = 0; y < height; y++) for (int x = 0; x < width * 3; x++) REQUIRE(fgetc(file) == expected->data[0][y * expected->linesize[0] + x]);
    REQUIRE(fgetc(file) == EOF); REQUIRE(fclose(file) == 0);
#ifndef _WIN32
    struct stat status; REQUIRE(stat(Config.frame_path, &status) == 0); REQUIRE((status.st_mode & 0777) == 0600);
#endif
}

static void test_capture(void) {
    REQUIRE(!capture_frame(1));
    uint64_t id;
    REQUIRE(parse_capture_request("1", &id) && id == 1);
    REQUIRE(parse_capture_request("9007199254740991", &id) && id == MAX_CAPTURE_REQUEST_ID);
    const char* invalid[] = {"", "0", "-1", "+1", "1x", "1 ", " 1", "9007199254740992", "18446744073709551616"};
    for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); i++) REQUIRE(!parse_capture_request(invalid[i], &id));
    char invalid_command[] = "capture -1"; REQUIRE(command(invalid_command));
    AVFrame* frame = rgb_frame(17, 13, 7);
    REQUIRE(retain_frame(frame) == 0); REQUIRE(Video.sequence == 1);
    FILE* absent = fopen(Config.frame_path, "rb"); REQUIRE(absent == NULL);
    REQUIRE(capture_frame(2)); check_ppm(frame);
    uint8_t* reused = Video.rgb[0];
    REQUIRE(capture_frame(3)); REQUIRE(Video.rgb[0] == reused); check_ppm(frame);
    FailClone = true;
    REQUIRE(retain_frame(frame) != 0); REQUIRE(Video.sequence == 1);
    REQUIRE(!capture_frame(4));
    FailClone = false; check_ppm(frame);
    av_frame_free(&frame);
    frame = rgb_frame(29, 11, 31); REQUIRE(retain_frame(frame) == 0);
    FailRgbAllocation = true; REQUIRE(!capture_frame(5)); REQUIRE(Video.rgb[0] == NULL);
    FailRgbAllocation = false; REQUIRE(capture_frame(6)); check_ppm(frame);
    av_frame_free(&frame);
    char valid_path[PATH_MAX]; copy_value(valid_path, sizeof(valid_path), Config.frame_path);
    // Renaming over an existing directory must fail and remove the .tmp file.
    char* slash = strrchr(Config.frame_path, '/');
#ifdef _WIN32
    char* backslash = strrchr(Config.frame_path, '\\'); if (backslash != NULL && (slash == NULL || backslash > slash)) slash = backslash;
#endif
    REQUIRE(slash != NULL); *slash = '\0';
    REQUIRE(!capture_frame(7));
    char temporary[PATH_MAX + 8]; snprintf(temporary, sizeof(temporary), "%s.tmp", Config.frame_path);
    absent = fopen(temporary, "rb"); REQUIRE(absent == NULL);
    copy_value(Config.frame_path, sizeof(Config.frame_path), valid_path);
    REQUIRE(capture_frame(8));
    video_cleanup(); REQUIRE(Video.latest == NULL && Video.rgb[0] == NULL && Video.scaler == NULL);
    video_cleanup(); REQUIRE(!capture_frame(9));
}

// A competing decoded-frame producer exercises ref lifetime while captures
// convert/replace files. Every frame is uniform, so mixed/torn pixels are clear.
static void producer(void) {
    for (int i = 0; i < 200; i++) {
        AVFrame* frame = rgb_frame(128, 96, i % 251);
        REQUIRE(retain_frame(frame) == 0); av_frame_free(&frame);
    }
}
#ifdef _WIN32
static DWORD WINAPI producer_entry(LPVOID unused) { (void)unused; producer(); return 0; }
#else
static void* producer_entry(void* unused) { (void)unused; producer(); return NULL; }
#endif
static void test_concurrent_capture(void) {
    AVFrame* seed = rgb_frame(128, 96, 0); REQUIRE(retain_frame(seed) == 0); av_frame_free(&seed);
#ifdef _WIN32
    HANDLE thread = CreateThread(NULL, 0, producer_entry, NULL, 0, NULL); REQUIRE(thread != NULL);
#else
    pthread_t thread; REQUIRE(pthread_create(&thread, NULL, producer_entry, NULL) == 0);
#endif
    for (int i = 0; i < 40; i++) {
        REQUIRE(capture_frame((uint64_t)(100 + i)));
        FILE* file = fopen(Config.frame_path, "rb"); REQUIRE(file != NULL);
        char line[64]; REQUIRE(fgets(line, sizeof(line), file) != NULL); REQUIRE(fgets(line, sizeof(line), file) != NULL); REQUIRE(fgets(line, sizeof(line), file) != NULL);
        int seed_value = fgetc(file); REQUIRE(seed_value != EOF);
        for (int y = 0; y < 96; y++) for (int x = 0; x < 128 * 3; x++) {
            if (y == 0 && x == 0) continue;
            REQUIRE(fgetc(file) == (seed_value + x + y) % 251);
        }
        REQUIRE(fgetc(file) == EOF); fclose(file);
    }
#ifdef _WIN32
    REQUIRE(WaitForSingleObject(thread, INFINITE) == WAIT_OBJECT_0); CloseHandle(thread);
#else
    REQUIRE(pthread_join(thread, NULL) == 0);
#endif
    video_cleanup();
}

static AVPacket* Packets[30];
static void encode_fixture(void) {
    const AVCodec* codec = avcodec_find_encoder_by_name("libx264"); REQUIRE(codec != NULL);
    AVCodecContext* encoder = avcodec_alloc_context3(codec); REQUIRE(encoder != NULL);
    encoder->width = 64; encoder->height = 48; encoder->pix_fmt = AV_PIX_FMT_YUV420P;
    encoder->time_base = (AVRational){1, 30}; encoder->framerate = (AVRational){30, 1};
    encoder->max_b_frames = 0; encoder->gop_size = 30;
    REQUIRE(av_opt_set(encoder->priv_data, "preset", "ultrafast", 0) == 0);
    REQUIRE(av_opt_set(encoder->priv_data, "tune", "zerolatency", 0) == 0);
    REQUIRE(av_opt_set(encoder->priv_data, "qp", "0", 0) == 0);
    REQUIRE(av_opt_set(encoder->priv_data, "x264-params", "slices=4", 0) == 0);
    REQUIRE(avcodec_open2(encoder, codec, NULL) == 0);
    AVFrame* frame = av_frame_alloc(); REQUIRE(frame != NULL);
    frame->format = encoder->pix_fmt; frame->width = encoder->width; frame->height = encoder->height;
    REQUIRE(av_frame_get_buffer(frame, 32) == 0);
    int packets = 0;
    for (int i = 0; i < 30; i++) {
        REQUIRE(av_frame_make_writable(frame) == 0); frame->pts = i;
        for (int plane = 0; plane < 3; plane++) {
            int width = plane == 0 ? 64 : 32, height = plane == 0 ? 48 : 24;
            for (int y = 0; y < height; y++) memset(frame->data[plane] + y * frame->linesize[plane], plane == 0 ? 18 + i * 3 : plane == 1 ? 80 + i : 128, (size_t)width);
        }
        REQUIRE(avcodec_send_frame(encoder, frame) == 0);
        for (;;) {
            AVPacket* packet = av_packet_alloc(); REQUIRE(packet != NULL);
            int result = avcodec_receive_packet(encoder, packet);
            if (result == AVERROR(EAGAIN)) { av_packet_free(&packet); break; }
            REQUIRE(result == 0 && packets < 30); Packets[packets++] = packet;
        }
    }
    REQUIRE(packets == 30); av_frame_free(&frame); avcodec_free_context(&encoder);
}

static int decode_fixture(bool baseline) {
    REQUIRE(video_setup(VIDEO_FORMAT_H264, 64, 48, 30, NULL, 0) == 0);
    if (baseline) {
        avcodec_free_context(&Video.decoder);
        const AVCodec* codec = avcodec_find_decoder(AV_CODEC_ID_H264);
        Video.decoder = avcodec_alloc_context3(codec); REQUIRE(Video.decoder != NULL);
        Video.decoder->thread_count = 0; Video.decoder->thread_type = FF_THREAD_FRAME;
        REQUIRE(avcodec_open2(Video.decoder, codec, NULL) == 0);
    }
    int decoded = 0, first_packet = 0;
    for (int packet_index = 0; packet_index < 30; packet_index++) {
        REQUIRE(avcodec_send_packet(Video.decoder, Packets[packet_index]) == 0);
        for (;;) {
            int result = avcodec_receive_frame(Video.decoder, Video.frame);
            if (result == AVERROR(EAGAIN)) break;
            REQUIRE(result == 0);
            if (first_packet == 0) first_packet = packet_index + 1;
            for (int plane = 0; plane < 3; plane++) {
                int width = plane == 0 ? 64 : 32, height = plane == 0 ? 48 : 24;
                for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) REQUIRE(Video.frame->data[plane][y * Video.frame->linesize[plane] + x] == (plane == 0 ? 18 + decoded * 3 : plane == 1 ? 80 + decoded : 128));
            }
            decoded++; av_frame_unref(Video.frame);
        }
        if (!baseline) REQUIRE(decoded == packet_index + 1);
    }
    int before_drain = decoded;
    REQUIRE(avcodec_send_packet(Video.decoder, NULL) == 0);
    while (avcodec_receive_frame(Video.decoder, Video.frame) == 0) { decoded++; av_frame_unref(Video.frame); }
    REQUIRE(decoded == 30);
    emit("{\"type\":\"fixture_decoder\",\"mode\":\"%s\",\"firstOutputPacket\":%d,\"outputBeforeDrain\":%d,\"total\":%d,\"activeThreadType\":%d}\n", baseline ? "frame_auto" : "slice_4_low_delay", first_packet, before_drain, decoded, Video.decoder->active_thread_type);
    video_cleanup(); return first_packet;
}

static void test_decode_callback(void) {
    REQUIRE(video_setup(VIDEO_FORMAT_H264, 64, 48, 30, NULL, 0) == 0);
    uint64_t initial_sequence = Video.sequence;
    for (int i = 0; i < 30; i++) {
        LENTRY entry; memset(&entry, 0, sizeof(entry)); entry.data = (char*)Packets[i]->data; entry.length = Packets[i]->size;
        DECODE_UNIT unit; memset(&unit, 0, sizeof(unit)); unit.fullLength = entry.length; unit.bufferList = &entry;
        REQUIRE(submit_decode_unit(&unit) == DR_OK); REQUIRE(Video.sequence == initial_sequence + i + 1);
        if (i == 0) REQUIRE(remove(Config.frame_path) == 0);
        FILE* absent = fopen(Config.frame_path, "rb"); REQUIRE(absent == NULL);
        av_usleep(34000);
    }
    REQUIRE(capture_frame(500)); REQUIRE(Video.latest->data[0][0] == 18 + 29 * 3);
    video_cleanup();
}

int main(int argc, char** argv) {
    REQUIRE(argc == 2); copy_value(Config.frame_path, sizeof(Config.frame_path), argv[1]);
    av_log_set_level(AV_LOG_ERROR);
    test_capture(); test_concurrent_capture();
    encode_fixture(); int old_first = decode_fixture(true), new_first = decode_fixture(false);
    REQUIRE(new_first == 1 && old_first > new_first);
    event("test_phase", "decode_notifications"); test_decode_callback();
    for (int i = 0; i < 30; i++) av_packet_free(&Packets[i]);
    video_cleanup(); REQUIRE(remove(Config.frame_path) == 0);
    event("test_complete", "native capture and decoder fixture passed");
    return 0;
}
