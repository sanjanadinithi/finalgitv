@echo off
echo ============================================================
echo   Component 3 -- Memory/Failure Predictor
echo ============================================================

echo [1/4] Installing dependencies...
python -m pip install -r requirements.txt --quiet
python -m pip install win10toast plyer --quiet

echo [2/4] Training model (LOPO CV + SHAP + data/memory_predictions.csv)...
if not exist "data" mkdir data
if exist "models\memory_leak_rf_model.pkl" (
    echo       models\memory_leak_rf_model.pkl already exists -- skipping training.
    echo       Delete it and re-run this script to retrain.
) else (
    python scripts/train_model.py
)

echo [3/4] Starting live simulator in new window...
start "Live Simulator" cmd /k python scripts/simulate_live.py

echo [4/4] Component 3 is streaming to the Component 4 API on http://localhost:8000/docs
pause
