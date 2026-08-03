-- ==========================================
-- 記帳米粒 Migration：繳費功能獨立成專屬頁面後，功能狀態表補上對應項目
-- 執行方式：mysql -u帳號 -p 資料庫名稱 < migration_bills_dashboard.sql
-- ==========================================
INSERT IGNORE INTO feature_switches (feature_key, status, label) VALUES
    ('bills_dashboard', 'normal', '繳費管理（監控後台頁面）');
