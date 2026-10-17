// ── Execução do Pipeline Backend ──
  const executePipeline = async (clientUri, v1Uri, v2Uri) => {
    setFlowStage("processing");
    const isPreGen = arrangementMode === "pre_generated" && Boolean(v1Uri && v2Uri);
    // Reduzimos o total de etapas visíveis pois o Drive agora roda em segundo plano
    setTotalSteps(isPreGen ? 5 : 6); 

    const styleToUse = generatedPrompt.trim() || customStyle.trim() || selectedStyle;

    setPipelineStep(1);
    setPipelineMessage("Iniciando esteira musical...");

    const t1 = setTimeout(() => {
      setPipelineStep(2);
      setPipelineMessage(
        isPreGen
          ? "Carregando versões de IA fornecidas (criação no Suno dispensada)..."
          : "Transcrevendo áudio com Gemini e gerando prompt no Suno..."
      );
    }, 3000);

    const t2 = setTimeout(() => {
      setPipelineStep(3);
      setPipelineMessage("Separando vocais e instrumentais das 2 versões...");
    }, 12000);

    const t3 = setTimeout(() => {
      setPipelineStep(4);
      setPipelineMessage("Limpando e masterizando a voz do cliente no Music.ai...");
    }, 24000);

    const t4 = setTimeout(() => {
      setPipelineStep(5);
      setPipelineMessage("Sincronizando e mixando a voz masterizada nas 2 versões (DSP)...");
    }, 38000);

    try {
      const payload = {
        client_audio_uri: clientUri,
        phone,
        customer_name: customerName,
        style_choice: styleToUse,
      };

      if (isPreGen) {
        payload.pre_generated_v1_uri = v1Uri;
        payload.pre_generated_v2_uri = v2Uri;
      }

      // 1. Chama o processamento de áudio (agora super rápido sem o Drive)
      const res = await base44.functions.invoke("runPipeline", payload);

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);

      if (res.data?.success) {
        setJobResults(res.data);
        setPipelineStep(isPreGen ? 5 : 6);
        setPipelineMessage("Produção finalizada com sucesso!");
        
        // Libera a tela IMEDIATAMENTE para o usuário ouvir a música!
        setFlowStage("ready"); 

        // 2. CHAMADA SILENCIOSA: Envia para o Drive em background (não bloqueia a tela)
        if (res.data.downloads) {
          base44.functions.invoke("saveToDrive", {
            job_id: res.data.job?.id,
            phone: phone,
            urls: res.data.downloads
          }).then(driveRes => {
            console.log("Upload para o Drive concluído com sucesso:", driveRes.data);
          }).catch(driveErr => {
            console.error("Falha ao salvar no Drive (background):", driveErr);
          });
        }

      } else {
        const errorMsg = res.data?.error || "Falha na produção do áudio";
        throw new Error(errorMsg);
      }
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);

      console.error("Erro no pipeline:", err);
      const serverError =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Erro de processamento";

      setDetailedError({
        message: serverError,
        step: pipelineMessage,
      });
      setFlowStage("error");
    }
  };