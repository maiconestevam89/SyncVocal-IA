{/* Subsitua a seção do card "Sua Produção Está Pronta!" em src/pages/Landing.jsx por este trecho: */}

{flowStage === "completed" && jobResults && (
  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
    {/* Cabeçalho */}
    <div className="text-center space-y-2">
      <div className="inline-flex p-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2">
        <CheckCircle2 className="w-8 h-8" />
      </div>
      <h2 className="text-3xl font-extrabold text-white">Sua Produção Está Pronta!</h2>
      <p className="text-sm text-slate-400 max-w-xl mx-auto">
        Todas as faixas foram mixadas e sincronizadas com sucesso. Baixe os arquivos abaixo ou envie a prévia para o cliente:
      </p>
    </div>

    {/* ALERTA GOOGLE DRIVE (com botão Continuar Assim Mesmo) */}
    {jobResults.drive_status?.saved === false && !dismissDriveAlert && (
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="text-xs sm:text-sm">
            <span className="font-bold">Aviso sobre o Google Drive: </span>
            {jobResults.drive_status?.message || "Não foi possível salvar no Google Drive neste momento. Seus arquivos foram gerados normalmente e estão disponíveis para download abaixo."}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDismissDriveAlert(true)}
          className="border-amber-500/40 text-amber-300 hover:bg-amber-500/20 text-xs shrink-0"
        >
          Continuar assim mesmo
        </Button>
      </div>
    )}

    <div className="space-y-6">
      <h3 className="text-xl font-bold text-white flex items-center gap-2">
        <FileMusic className="w-5 h-5 text-indigo-400" /> Central de Downloads da Produção
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* BLOCO 1: Mixagem com a Voz (Disponível em WAV e MP3) */}
        <Card className="bg-slate-900 border-indigo-500/40 shadow-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-indigo-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" /> Mixagem com a Voz (Sincronizada)
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">Voz mixada com instrumental sincronizado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* FINAL COM VOZ 01 */}
            <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                <span>FINAL COM VOZ 01</span>
                <div className="flex gap-3">
                  {jobResults.downloads?.final_voz_1 && (
                    <a href={jobResults.downloads.final_voz_1} download className="text-indigo-400 hover:underline">Baixar WAV</a>
                  )}
                  {jobResults.downloads?.final_voz_1_mp3 && (
                    <a href={jobResults.downloads.final_voz_1_mp3} download className="text-indigo-400 hover:underline">Baixar MP3</a>
                  )}
                </div>
              </div>
              {jobResults.downloads?.final_voz_1 && (
                <audio controls className="w-full h-8" src={jobResults.downloads.final_voz_1} />
              )}
            </div>

            {/* FINAL COM VOZ 02 */}
            <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                <span>FINAL COM VOZ 02</span>
                <div className="flex gap-3">
                  {jobResults.downloads?.final_voz_2 && (
                    <a href={jobResults.downloads.final_voz_2} download className="text-indigo-400 hover:underline">Baixar WAV</a>
                  )}
                  {jobResults.downloads?.final_voz_2_mp3 && (
                    <a href={jobResults.downloads.final_voz_2_mp3} download className="text-indigo-400 hover:underline">Baixar MP3</a>
                  )}
                </div>
              </div>
              {jobResults.downloads?.final_voz_2 && (
                <audio controls className="w-full h-8" src={jobResults.downloads.final_voz_2} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* BLOCO 2: Playbacks Instrumentais (Disponível em MP3 e WAV) */}
        <Card className="bg-slate-900 border-slate-800 shadow-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-amber-300 flex items-center gap-2">
              <Headphones className="w-4 h-4 text-amber-400" /> Playbacks Instrumentais
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">Instrumentais originais para shows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* PLAYBACK 01 */}
            <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                <span>PLAYBACK 01</span>
                <div className="flex gap-3">
                  {jobResults.downloads?.playback_1 && (
                    <a href={jobResults.downloads.playback_1} download className="text-amber-400 hover:underline">Baixar MP3</a>
                  )}
                  {jobResults.downloads?.playback_1_wav && (
                    <a href={jobResults.downloads.playback_1_wav} download className="text-amber-400 hover:underline">Baixar WAV</a>
                  )}
                </div>
              </div>
              {jobResults.downloads?.playback_1 && (
                <audio controls className="w-full h-8" src={jobResults.downloads.playback_1} />
              )}
            </div>

            {/* PLAYBACK 02 */}
            <div className="space-y-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-200">
                <span>PLAYBACK 02</span>
                <div className="flex gap-3">
                  {jobResults.downloads?.playback_2 && (
                    <a href={jobResults.downloads.playback_2} download className="text-amber-400 hover:underline">Baixar MP3</a>
                  )}
                  {jobResults.downloads?.playback_2_wav && (
                    <a href={jobResults.downloads.playback_2_wav} download className="text-amber-400 hover:underline">Baixar WAV</a>
                  )}
                </div>
              </div>
              {jobResults.downloads?.playback_2 && (
                <audio controls className="w-full h-8" src={jobResults.downloads.playback_2} />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* BLOCO 3: Botão Enviar Prévia (Sem player de áudio) */}
      <Card className="bg-slate-900 border-emerald-500/30 p-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-400" /> Envio de Prévia (1:10) e Cobrança
            </h4>
            <p className="text-xs text-slate-400">
              Dispara o robô no WhatsApp com a prévia cortada e o botão para o cliente copiar a chave Pix.
            </p>
          </div>
          <Button
            onClick={handleSendPreviewToClient}
            disabled={sendingPreview}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-6 py-2 rounded-lg shrink-0 gap-2"
          >
            {sendingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendingPreview ? "Enviando..." : "Enviar prévia"}
          </Button>
        </div>
      </Card>
    </div>

    {/* Ações Inferiores */}
    <div className="flex justify-center pt-4">
      <Button onClick={() => setFlowStage("initial")} variant="outline" className="border-slate-700 text-slate-200 gap-2">
        <RotateCcw className="w-4 h-4" /> Produzir Outra Música
      </Button>
    </div>
  </div>
)}
