@echo off
cd /d "c:\Users\Rafba\OneDrive\Documents\Crm\lume-crm"
rem Use dev server on 5173 so /api proxy always works.
npm.cmd run dev -- --host 0.0.0.0 --port 5173
