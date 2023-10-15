import {
  DEFAULT_API_HOST,
  DEFAULT_MODELS,
  OpenaiPath,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import { useAccessStore, useAppConfig, useChatStore } from "@/app/store";

import { ChatOptions, getHeaders, LLMApi, LLMModel, LLMUsage, GPTFunction, GPTFunctionParameters, GPTFunctionProperty } from "../api";
import Locale from "../../locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "@/app/utils/format";
import { getClientConfig } from "@/app/config/client";

import axios from 'axios';
import { format } from 'date-fns';



export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}



export class ChatGPTApi implements LLMApi {
  private disableListModels = true;

  path(path: string): string {
    let openaiUrl = useAccessStore.getState().openaiUrl;
    const apiPath = "/api/openai";

    if (openaiUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      openaiUrl = isApp ? DEFAULT_API_HOST : apiPath;
    }
    if (openaiUrl.endsWith("/")) {
      openaiUrl = openaiUrl.slice(0, openaiUrl.length - 1);
    }
    if (!openaiUrl.startsWith("http") && !openaiUrl.startsWith(apiPath)) {
      openaiUrl = "https://" + openaiUrl;
    }
    return [openaiUrl, path].join("/");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }
  
  

  async chat(options: ChatOptions) {
    
    let functions: GPTFunction[] = [];

    let today_str: string;

    const today = new Date();
    today_str = format(today, 'yyyy-MM-dd');

    async function search_stock_info(ticker_symbol: string) {
      const url = `https://api.polygon.io/v1/open-close/${ticker_symbol}?adjusted=true&apiKey=${process.env.polygonApiKey}`;
      try {
          const response = await axios.get(url);
          return JSON.stringify(response.data);
      } catch (error) {
          console.error(`Ein Fehler ist aufgetreten: ${error}`);
          return null;
        }
    }
  

    console.log("options.messages array:", options.messages);

    let messages = options.messages.slice();
    let stopFunctionCalling = false;
    
    messages = messages
      .filter((v) => {
        if (v.role === 'function') {
          console.log("v.role === 'function':", v);

          let formattedInput = v.content;

          const regex_code = /^```json\n|```$/g;
          formattedInput = formattedInput.replace(regex_code, '');

          formattedInput = formattedInput.replace(/([{,]\s*)([a-zA-Z0-9_$]+):/g, '$1"$2":');

          const regex = /\,(?=\s*?[\}\]])/g;
          
          formattedInput = formattedInput.replace(regex, '');
        
          // console.log("Formatted Input: ", formattedInput);  // Debugging Step 1

          const validJsonString = formattedInput.replace(/(\w+):/g, '"$1":');
          
          const parsedObject = JSON.parse(validJsonString);
          
          if (parsedObject.hasOwnProperty('name') && parsedObject.hasOwnProperty('description') && parsedObject.hasOwnProperty('parameters')) {
            functions.push(parsedObject);
          } else {
            console.error("Invalid GPTFunction object", parsedObject);
          }

          return false;
        }
        return true;
      })
      .map((v) => ({
        role: v.role,
        content: v.content
      }));


    // Check if the last message contains "FUNCTION_CALLING:STOP"
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.content.includes("FUNCTION_CALLING:STOP") && lastMessage.role!="system") {
        stopFunctionCalling = true; 
      }
    }
    
    console.log("messages array:", messages);

    console.log("functions array:", functions);
    
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
      },
    };

    interface PayloadConfig {
      messages: any; // Replace with the actual type
      model: string;
      temperature: number;
      presence_penalty: number;
      frequency_penalty: number;
      top_p: number;
      functions?: GPTFunction[]; 
      function_call?: string;
      stream?: boolean;
    }

    const requestPayload: PayloadConfig = {
      messages,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      presence_penalty: modelConfig.presence_penalty,
      frequency_penalty: modelConfig.frequency_penalty,
      top_p: modelConfig.top_p,
    };

    if (Array.isArray(functions) && functions.length > 0 && !stopFunctionCalling) {
      requestPayload.functions = functions;
      requestPayload.function_call = "auto";
      requestPayload.stream = false;
    } else {
      requestPayload.stream = options.config.stream;
    }
  
    
    console.log("[Request] openai payload: ", requestPayload);

    

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);
    

    try {
      const chatPath = this.path(OpenaiPath.ChatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      

      if (shouldStream) {
        let responseText = "";
        let finished = false;

        const finish = () => {
          if (!finished) {

            console.log("responseText:", responseText);            
            options.onFinish(responseText);
            finished = true;
          }
        };

        controller.signal.onabort = finish;

        fetchEventSource(chatPath, {
          ...chatPayload,
          async onopen(res) {
            clearTimeout(requestTimeoutId);
            const contentType = res.headers.get("content-type");
            console.log(
              "[OpenAI] request response content type: ",
              contentType,
            );

            if (contentType?.startsWith("text/plain")) {
              responseText = await res.clone().text();

              console.error("[Response] text/plain: ", res);

              return finish();
            }

              console.error("[Response] not text/plain: ", res);
            
            if (
              !res.ok ||
              !res.headers
                .get("content-type")
                ?.startsWith(EventStreamContentType) ||
              res.status !== 200
            ) {
              const responseTexts = [responseText];
              let extraInfo = await res.clone().text();
              try {
                const resJson = await res.clone().json();
                extraInfo = prettyObject(resJson);
              } catch {}

              if (res.status === 401) {
                responseTexts.push(Locale.Error.Unauthorized);
              }

              if (extraInfo) {
                responseTexts.push(extraInfo);
              }

              responseText = responseTexts.join("\n\n");

              {/*
              const responseTextJSON = JSON.parse(responseTexts.join(''));
              if (responseTextJSON.hasOwnProperty('choices')) {
                  console.log("[responseTextJSON]: ", responseTextJSON);
              } else {
                console.error("Invalid responseTextJSON object", responseTexts);
              }
              */}          
              
              return finish();
            }
          },
          onmessage(msg) {
            if (msg.data === "[DONE]" || finished) {

              console.error("msg.data === : ", msg);
              
              return finish();
            }
            const text = msg.data;
            try {
              const json = JSON.parse(text);

              console.error("[Request] onmessage(msg): ", json);
              
              const delta = json.choices[0].delta.content;
              if (delta) {
                responseText += delta;
                options.onUpdate?.(responseText, delta);
              }
            } catch (e) {
              console.error("[Request] parse error", text, msg);
            }
          },
          onclose() {

            console.error("[Request] onclose: ");
            
            finish();
          },
          onerror(e) {

            console.error("[Request] onclose: ", e);

            options.onError?.(e);
            throw e;
          },
          openWhenHidden: true,
        });
      } 
      
      else {

        // Track Executed Functions to Prevent Unnecessary Invocations
        let executedFunctions = {};

        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();

        console.error("[Request] else: ", resJson);
        
        const message = this.extractMessage(resJson);
        console.error("[Request] message: ", resJson);

         // Loop to process the conversation until it finishes.
        while (
          resJson.choices[0].message.function_call &&
          resJson.choices[0].finish_reason !== "stop"
        ){
          // 16. Extracts the function call from the response.
          const function_name = message.function_call.name;

          // 17. Breaks the loop if function has already been executed.
          if (executedFunctions[function_name]) {
          break;  
          }

          // 18. Calls the appropriate function based on the name.
          let function_response = "";
          switch (function_name) {
            case "get_stock_info":
              let stockArgs = JSON.parse(message.function_call.arguments);
              function_response = await search_stock_info(stockArgs.ticker_symbol);
              break;
            
            default:
                throw new Error(`Unsupported function: ${function_name}`);
            }
          
          // 19. Updates the executedFunctions object to prevent unnecessary function calls.
          executedFunctions[function_name] = true;

          // 20. Appends the function response to the messages list.
          requestPayload.prompt += `\n${function_response}`;

          // 21. Makes another API request with the updated messages list.
          console.log(`Sending request to OpenAI with ${function_name} response...`);
          res = await fetch(chatPath, chatPayload);
          clearTimeout(requestTimeoutId);

          resJson = await res.json();

          console.error("[Request] else: ", resJson);
        
          message = this.extractMessage(resJson);
          console.error("[Request] message: ", resJson);
        }

        // 22. Makes the final API request after the conversation is finished.
        res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        resJson = await res.json();

        console.error("[Request] else: ", resJson);
        
        message = this.extractMessage(resJson);
        console.error("[Request] message: ", resJson);

        // 23. Returns the final response data.
        return message;
        options.onFinish(message);
       
      }
        

    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }

    
    console.log(responseText);

  }
  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [used, subs] = await Promise.all([
      fetch(
        this.path(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(),
        },
      ),
      fetch(this.path(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(),
      }),
    ]);

    if (used.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used.ok || !subs.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = (await used.json()) as {
      total_usage?: number;
      error?: {
        type: string;
        message: string;
      };
    };

    const total = (await subs.json()) as {
      hard_limit_usd?: number;
    };

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return DEFAULT_MODELS.slice();
    }

    const res = await fetch(this.path(OpenaiPath.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    const resJson = (await res.json()) as OpenAIListModelResponse;
    const chatModels = resJson.data?.filter((m) => m.id.startsWith("gpt-"));
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    return chatModels.map((m) => ({
      name: m.id,
      available: true,
    }));
  }
}

declare global {
  namespace NodeJS {
    export interface ProcessEnv {
      polygonApiKey: string
    }
  }
}

export { OpenaiPath };
