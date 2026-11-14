# Generates fixtures/student-speech.wav (Windows SAPI TTS, 16 kHz mono) for the e2e smoke test.
# Chrome plays it as the fake microphone (--use-file-for-fake-audio-capture) and loops it.
# The explanation contains the two demo misconceptions: "glucose is made in the roots" and "oxygen is taken in".
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot "student-speech.wav"
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($out, $fmt)
$p = New-Object System.Speech.Synthesis.PromptBuilder
$p.AppendBreak([TimeSpan]::FromSeconds(8))
$p.AppendText("Hi Sam. Today I will teach you photosynthesis. Plants take in carbon dioxide and water, and use light to make glucose.")
$p.AppendBreak([TimeSpan]::FromSeconds(5))
$p.AppendText("The sunlight travels down the stem to the roots, and the glucose is made in the roots. The plant also takes in oxygen.")
$p.AppendBreak([TimeSpan]::FromSeconds(6))
$p.AppendText("Okay Sam, I am finished. Can you check my explanation and open my gap report?")
$p.AppendBreak([TimeSpan]::FromSeconds(30))
$s.Speak($p)
$s.Dispose()
Write-Output "wrote $out"
