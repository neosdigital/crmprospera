@echo off
rem Backup diario do CRM Prospera — executado pelo Agendador de Tarefas do Windows
rem (tarefa "CRM Prospera - Backup diario"). Ver packages/db/scripts/backup.ts.
cd /d "%~dp0..\..\.."
call npx tsx packages\db\scripts\backup.ts
