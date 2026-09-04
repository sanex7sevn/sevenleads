@echo off
REM Inicia o tunel ngrok com o dominio estatico
cd /d C:\Users\Usuario\Desktop\sevenleads
timeout /t 8 /nobreak >nul
start "SevenLeads Tunnel" /min ngrok http --url=bootie-nest-disrupt.ngrok-free.dev 3000
