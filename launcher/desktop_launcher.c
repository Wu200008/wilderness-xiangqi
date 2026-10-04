#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show)
{
    (void)instance; (void)previous; (void)arguments; (void)show;
    wchar_t root[32768], runtime[32768], command[32768];
    DWORD n = GetModuleFileNameW(NULL, root, 32768);
    if (!n || n >= 16000) return 1;
    wchar_t *last = wcsrchr(root, L'\\');
    if (!last) return 1;
    *last = 0;
    swprintf(runtime, 32768, L"%ls\\runtime\\electron.exe", root);
    swprintf(command, 32768, L"\"%ls\" \"%ls\"", runtime, root);
    STARTUPINFOW startup = {0}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {0};
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", NULL);
    SetEnvironmentVariableW(L"WILD_CHESS_TEST", NULL);
    if (!CreateProcessW(runtime, command, NULL, NULL, FALSE, 0, NULL, root, &startup, &process)) {
        MessageBoxW(NULL, L"无法打开荒野象棋。请先完整解压发行包，并保留 app、engines 和 runtime 文件夹。",
                    L"荒野象棋", MB_OK | MB_ICONERROR);
        return 1;
    }
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    return 0;
}
