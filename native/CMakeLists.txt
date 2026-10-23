cmake_minimum_required(VERSION 3.16)
project(moonlight_mcp_session_bridge LANGUAGES C)

set(MOONLIGHT_CORE_DIR "" CACHE PATH "Path to a moonlight-common-c checkout")
if(NOT EXISTS "${MOONLIGHT_CORE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "Set MOONLIGHT_CORE_DIR to a checkout of moonlight-common-c (including enet and nanors submodules).")
endif()

# The pinned core defaults to a shared library without Windows DLL exports.
# Embed it on Windows so both symbol linkage and runtime loading work without
# an extra private DLL search path beside the controller executable.
if(WIN32)
  set(BUILD_SHARED_LIBS OFF)
endif()
add_subdirectory("${MOONLIGHT_CORE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/moonlight-common-c")

find_path(AVCODEC_INCLUDE_DIR libavcodec/avcodec.h REQUIRED)
find_library(AVCODEC_LIBRARY avcodec REQUIRED)
find_library(AVUTIL_LIBRARY avutil REQUIRED)
find_library(SWSCALE_LIBRARY swscale REQUIRED)

find_package(Threads REQUIRED)

add_executable(moonlight-session-bridge session_bridge.c)
# Visual Studio/Xcode otherwise append Release/Debug, while the launcher and
# doctor consistently resolve the bridge directly inside native/build.
set_target_properties(moonlight-session-bridge PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "$<1:${CMAKE_CURRENT_BINARY_DIR}>")
target_compile_features(moonlight-session-bridge PRIVATE c_std_11)
target_include_directories(moonlight-session-bridge PRIVATE "${AVCODEC_INCLUDE_DIR}")
target_link_libraries(moonlight-session-bridge PRIVATE
  moonlight-common-c
  Threads::Threads
  "${AVCODEC_LIBRARY}"
  "${AVUTIL_LIBRARY}"
  "${SWSCALE_LIBRARY}"
)

# Opt-in: the installed source package need not ship fixture/test dependencies.
option(MOONLIGHT_BUILD_NATIVE_TESTS "Build host-free capture/decoder fixture tests" OFF)
if(MOONLIGHT_BUILD_NATIVE_TESTS)
  enable_testing()
  find_package(Python3 COMPONENTS Interpreter REQUIRED)
  add_executable(moonlight-capture-test tests/capture_test.c)
  target_compile_features(moonlight-capture-test PRIVATE c_std_11)
  target_include_directories(moonlight-capture-test PRIVATE "${AVCODEC_INCLUDE_DIR}")
  target_link_libraries(moonlight-capture-test PRIVATE moonlight-common-c Threads::Threads
    "${AVCODEC_LIBRARY}" "${AVUTIL_LIBRARY}" "${SWSCALE_LIBRARY}")
  add_test(NAME native-capture-fixture COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/run_capture_tests.py" "$<TARGET_FILE:moonlight-capture-test>")
endif()
