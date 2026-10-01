cmake_minimum_required(VERSION 3.16)
project(moonlight_mcp_session_bridge LANGUAGES C)

set(MOONLIGHT_CORE_DIR "" CACHE PATH "Path to a moonlight-common-c checkout")
if(NOT EXISTS "${MOONLIGHT_CORE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "Set MOONLIGHT_CORE_DIR to a checkout of moonlight-common-c (including enet and nanors submodules).")
endif()

add_subdirectory("${MOONLIGHT_CORE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/moonlight-common-c")

find_path(AVCODEC_INCLUDE_DIR libavcodec/avcodec.h REQUIRED)
find_library(AVCODEC_LIBRARY avcodec REQUIRED)
find_library(AVUTIL_LIBRARY avutil REQUIRED)
find_library(SWSCALE_LIBRARY swscale REQUIRED)

add_executable(moonlight-session-bridge session_bridge.c)
target_compile_features(moonlight-session-bridge PRIVATE c_std_11)
target_include_directories(moonlight-session-bridge PRIVATE "${AVCODEC_INCLUDE_DIR}")
target_link_libraries(moonlight-session-bridge PRIVATE
  moonlight-common-c
  "${AVCODEC_LIBRARY}"
  "${AVUTIL_LIBRARY}"
  "${SWSCALE_LIBRARY}"
)
