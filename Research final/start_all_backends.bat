@echo off
chcp 65001 >nul
title Sentinel AIOps - SRE Command Center Launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_all_backends.ps1"
