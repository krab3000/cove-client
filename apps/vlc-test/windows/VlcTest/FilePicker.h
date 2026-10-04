#pragma once

#include <shobjidl_core.h>

#include <string>
#include <thread>

#include "NativeModules.h"

namespace VlcTest {

// FilePicker.pickFile(): the Windows open file dialog; resolves with the chosen file's path, or "" when cancelled.
REACT_MODULE(FilePicker)
struct FilePicker {
  REACT_METHOD(PickFile, L"pickFile")
  void PickFile(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    // Modal over the app's window, on a thread of its own (the dialog needs a single-threaded apartment).
    const HWND owner = GetForegroundWindow();
    std::thread([promise, owner]() mutable {
      const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
      try {
        auto dialog = winrt::create_instance<IFileOpenDialog>(CLSID_FileOpenDialog);
        const COMDLG_FILTERSPEC types[] = {
            {L"Video files", L"*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v;*.ts;*.m2ts;*.wmv;*.flv;*.mpg;*.mpeg;*.3gp"},
            {L"Audio files", L"*.mp3;*.flac;*.m4a;*.aac;*.ogg;*.opus;*.wav"},
            {L"All files", L"*.*"},
        };
        winrt::check_hresult(dialog->SetFileTypes(ARRAYSIZE(types), types));
        winrt::check_hresult(dialog->SetTitle(L"Open media"));
        const HRESULT shown = dialog->Show(owner);
        if (shown == HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
          promise.Resolve("");
        } else {
          winrt::check_hresult(shown);
          winrt::com_ptr<IShellItem> item;
          winrt::check_hresult(dialog->GetResult(item.put()));
          PWSTR path = nullptr;
          winrt::check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &path));
          const std::string result = winrt::to_string(path);
          CoTaskMemFree(path);
          promise.Resolve(result);
        }
      } catch (const winrt::hresult_error &e) {
        promise.Reject(winrt::to_string(e.message()).c_str());
      }
      if (SUCCEEDED(init))
        CoUninitialize();
    }).detach();
  }
};

} // namespace VlcTest
