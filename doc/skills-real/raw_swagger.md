{
  "openapi": "3.0.1",
  "info": {
    "title": "J1B API TOOL1",
    "description": "Fetch real-time data from system",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://jayabaji.ai-chat.life"
    }
  ],
  "paths": {
    "/v2/chatbot/get-latest-withdraw-status": {
      "post": {
        "description": "get-latest-withdraw-status",
        "operationId": "CheckLatestWithdrawalStatus",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  },
                  "gmt": {
                    "type": "string",
                    "description": "时区，默认填“-04:00”",
                    "default": "-04:00"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "time_passed": {
                      "type": "number",
                      "description": ""
                    },
                    "created_at": {
                      "type": "string",
                      "description": ""
                    },
                    "status": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/promotion-active-status": {
      "post": {
        "description": "check the turnover promotion active status",
        "operationId": "TurnoverPromotionActiveStatus",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "description": "",
                      "items": {
                        "type": "string",
                        "description": ""
                      }
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/withdraw-condition": {
      "post": {
        "description": "check trunover withdraw condition",
        "operationId": "TurnOverWithdrawCondition",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  },
                  "gmt": {
                    "type": "string",
                    "description": "默认填\"-4:00\"",
                    "default": "-4:00"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "description": "",
                      "items": {
                        "type": "string",
                        "description": ""
                      }
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/get-latest-deposit-status": {
      "post": {
        "description": "get-latest-deposit-status",
        "operationId": "CheckLatestDepositStatus",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  },
                  "gmt": {
                    "type": "string",
                    "description": "默认填\"-4:00\"",
                    "default": "-4:00"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "time_passed": {
                      "type": "number",
                      "description": ""
                    },
                    "created_at": {
                      "type": "string",
                      "description": ""
                    },
                    "status": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/promotion-eligible-status": {
      "post": {
        "description": "When users need to inquire about how to participate in promotional activities or obtain promotional rewards",
        "operationId": "Promotion",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "language",
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "UserID"
                  },
                  "language": {
                    "type": "string",
                    "description": "Language,must be:en-bd",
                    "default": "en-bd"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "description": "",
                      "items": {
                        "type": "arrayobject",
                        "description": ""
                      }
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

{
  "openapi": "3.0.1",
  "info": {
    "title": "J1B API TOOL2",
    "description": "more api",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://jayabaji.ai-chat.life"
    }
  ],
  "paths": {
    "/v2/chatbot/top-hot-game-list": {
      "post": {
        "description": "get recommend games for the member",
        "operationId": "get_recommend_games",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "description": "",
                      "items": {
                        "type": "arrayobject",
                        "description": ""
                      }
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/deposit-withdrawal-history": {
      "post": {
        "description": "get the recent 5 deposit or withdraw history records",
        "operationId": "get_transaction_history",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id",
                  "method"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  },
                  "method": {
                    "type": "string",
                    "description": "\"deposit\" or \"withdraw\""
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "description": "",
                      "items": {
                        "type": "arrayobject",
                        "description": ""
                      }
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/user-bet-history-summary": {
      "post": {
        "description": "get game bet history",
        "operationId": "get_bet_history",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "from_date",
                  "member_id",
                  "to_date"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  },
                  "from_date": {
                    "type": "string",
                    "description": "example format: \"2026-03-12 00:00:00\", use the value customer asked"
                  },
                  "to_date": {
                    "type": "string",
                    "description": "example format: \"2026-03-17 23:59:59\", use the value customer asked"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "description": "",
                      "items": {
                        "type": "arrayobject",
                        "description": ""
                      }
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/user-kyc-status": {
      "post": {
        "description": "get the details of the ID verification, which may include the stage that is currently stuck",
        "operationId": "get_id_verification_details",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member id"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "object",
                      "properties": {
                        "kyc_status": {
                          "type": "string",
                          "description": ""
                        }
                      },
                      "description": ""
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v2/chatbot/account-status": {
      "post": {
        "description": "get account status (such as login failure, account lockout, etc.)",
        "operationId": "get_account_status",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "required": [
                  "member_id"
                ],
                "type": "object",
                "properties": {
                  "member_id": {
                    "type": "string",
                    "description": "member_id"
                  }
                }
              }
            }
          },
          "required": true
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "object",
                      "properties": {
                        "status": {
                          "type": "string",
                          "description": ""
                        }
                      },
                      "description": ""
                    },
                    "message": {
                      "type": "string",
                      "description": ""
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}