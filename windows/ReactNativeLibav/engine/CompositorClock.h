#pragma once

#include <dwmapi.h>
#include <dxgi1_2.h>

#include <chrono>
#include <thread>

namespace ReactNativeLibav {

// Paces the render thread on the compositor: Wait() returns once per composited frame, right after the
// compositor has started it, so what is drawn next is picked up by the following frame. RefreshPeriod() is the
// time between frames.
// DCompositionWaitForCompositorClock (Windows 11) follows the compositor itself; older systems wait for the
// vertical blank of the primary output, which is close enough.
class CompositorClock {
 public:
  explicit CompositorClock(ID3D11Device *device) {
    if (HMODULE dcomp = LoadLibraryExW(L"dcomp.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32))
      m_waitForCompositorClock = reinterpret_cast<WaitForCompositorClockFn>(
          GetProcAddress(dcomp, "DCompositionWaitForCompositorClock"));
    if (!m_waitForCompositorClock && device) {
      winrt::com_ptr<IDXGIDevice> dxgiDevice;
      winrt::com_ptr<IDXGIAdapter> adapter;
      if (SUCCEEDED(device->QueryInterface(IID_PPV_ARGS(dxgiDevice.put()))) &&
          SUCCEEDED(dxgiDevice->GetAdapter(adapter.put())))
        adapter->EnumOutputs(0, m_output.put());
    }
    QueryPeriod();
  }

  void Wait() {
    if (m_waitForCompositorClock)
      m_waitForCompositorClock(0, nullptr, 100);
    else if (m_output)
      m_output->WaitForVBlank();
    else
      std::this_thread::sleep_for(std::chrono::duration<double>(m_period));
    if (++m_frames % 120 == 0) // the refresh rate can change (display moves, VRR, settings)
      QueryPeriod();
  }

  double RefreshPeriod() const noexcept { return m_period; }

 private:
  using WaitForCompositorClockFn = DWORD(WINAPI *)(UINT count, const HANDLE *handles, DWORD timeoutInMs);

  void QueryPeriod() {
    DWM_TIMING_INFO info{};
    info.cbSize = sizeof(info);
    LARGE_INTEGER frequency{};
    if (SUCCEEDED(DwmGetCompositionTimingInfo(nullptr, &info)) && info.qpcRefreshPeriod &&
        QueryPerformanceFrequency(&frequency)) {
      const double period = double(info.qpcRefreshPeriod) / double(frequency.QuadPart);
      if (period > 0.002 && period < 0.1)
        m_period = period;
    }
  }

  WaitForCompositorClockFn m_waitForCompositorClock = nullptr;
  winrt::com_ptr<IDXGIOutput> m_output;
  double m_period = 1.0 / 60;
  uint64_t m_frames = 0;
};

} // namespace ReactNativeLibav
